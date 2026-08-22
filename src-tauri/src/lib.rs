mod db;
mod error;
pub mod ranking; // consumed by later voting slices; kept Tauri-free
mod scanner;
#[allow(dead_code)]
mod thumbnails;
mod voting;

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::http::{StatusCode, Uri};
use tauri::{AppHandle, Emitter, Manager};

const SCAN_CHUNK_SIZE: usize = 256;

#[derive(Clone, Serialize)]
struct ScanProgress {
    scanned: u64,
    added: u64,
}

#[derive(Clone, Serialize)]
struct ScanComplete {
    added_count: u64,
}

pub struct Db(pub Mutex<rusqlite::Connection>);

pub struct CacheDir(pub PathBuf);

fn lock_conn(
    state: tauri::State<'_, Db>,
) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, error::AppError> {
    let db = state.inner();
    db.0.lock()
        .map_err(|_| error::AppError::Db("database lock poisoned".to_string()))
}

#[tauri::command]
fn get_pair(state: tauri::State<'_, Db>) -> Result<[voting::Wallpaper; 2], error::AppError> {
    let conn = lock_conn(state)?;
    voting::get_pair(&conn, &mut voting::SystemRng::new())
}

#[tauri::command]
fn vote(
    state: tauri::State<'_, Db>,
    winner_id: i64,
    loser_id: i64,
) -> Result<voting::VoteOutcome, error::AppError> {
    let conn = lock_conn(state)?;
    voting::vote(&conn, winner_id, loser_id, &mut voting::SystemRng::new())
}

#[tauri::command]
fn get_stats(state: tauri::State<'_, Db>) -> Result<voting::Stats, error::AppError> {
    let conn = lock_conn(state)?;
    voting::get_stats(&conn)
}

#[tauri::command]
fn start_scan(path: PathBuf, app: AppHandle) -> Result<(), error::AppError> {
    if !path.is_dir() {
        return Err(error::AppError::InvalidPath(path.display().to_string()));
    }
    std::thread::spawn(move || {
        let files = scanner::collect_images(std::slice::from_ref(&path));
        let mut scanned: u64 = 0;
        let mut added: u64 = 0;
        for chunk in files.chunks(SCAN_CHUNK_SIZE) {
            match app.state::<Db>().0.lock() {
                Ok(conn) => match db::insert_new_wallpapers(&conn, chunk) {
                    Ok(n) => added += n as u64,
                    Err(e) => eprintln!("scan insert failed: {e}"),
                },
                Err(_) => eprintln!("scan skipped a chunk: database lock poisoned"),
            }
            scanned += chunk.len() as u64;
            let _ = app.emit("scan-progress", ScanProgress { scanned, added });
        }
        let _ = app.emit("scan-complete", ScanComplete { added_count: added });
    });
    Ok(())
}

#[tauri::command]
fn get_review(limit: i64, state: tauri::State<Db>) -> Result<Vec<db::Wallpaper>, error::AppError> {
    let conn = state
        .0
        .lock()
        .map_err(|_| error::AppError::Db("database lock poisoned".into()))?;
    db::get_review(&conn, limit).map_err(Into::into)
}

#[tauri::command]
fn keep_wallpaper(id: i64, state: tauri::State<Db>) -> Result<(), error::AppError> {
    let conn = state
        .0
        .lock()
        .map_err(|_| error::AppError::Db("database lock poisoned".into()))?;
    db::keep_wallpaper(&conn, id)
}

#[tauri::command]
fn move_wallpaper(
    id: i64,
    destination_folder: String,
    state: tauri::State<Db>,
) -> Result<(), error::AppError> {
    let conn = state
        .0
        .lock()
        .map_err(|_| error::AppError::Db("database lock poisoned".into()))?;
    db::move_wallpaper(&conn, id, &destination_folder)
}

fn resolve_image(app: &AppHandle, uri: &Uri) -> Result<Vec<u8>, error::AppError> {
    let segments: Vec<&str> = uri.path().trim_start_matches('/').split('/').collect();
    let ["image", id] = segments.as_slice() else {
        return Err(error::AppError::BadRequest(format!(
            "unexpected path {:?}",
            uri.path()
        )));
    };
    let wallpaper_id: i64 = id
        .parse()
        .map_err(|_| error::AppError::BadRequest(format!("malformed wallpaper id {id:?}")))?;
    let size = uri
        .query()
        .and_then(|q| q.split('&').find_map(|p| p.strip_prefix("size=")))
        .and_then(thumbnails::Size::parse)
        .ok_or_else(|| {
            error::AppError::BadRequest(format!("missing or unknown size in {:?}", uri.query()))
        })?;
    let db = app.state::<Db>();
    let conn =
        db.0.lock()
            .map_err(|_| error::AppError::Db("database lock poisoned".into()))?;
    let cache_dir = app.state::<CacheDir>();
    Ok(thumbnails::resolve(&conn, &cache_dir.0, wallpaper_id, size)?.bytes)
}

fn image_response(status: StatusCode, body: Vec<u8>) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .header(tauri::http::header::CONTENT_TYPE, "image/jpeg")
        .header(
            tauri::http::header::CACHE_CONTROL,
            "max-age=31536000, immutable",
        )
        .body(body)
        .unwrap()
}

fn error_response(e: &error::AppError) -> tauri::http::Response<Vec<u8>> {
    let status = match e {
        error::AppError::InvalidPath(_) | error::AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
        error::AppError::NotFound(_) => StatusCode::NOT_FOUND,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    tauri::http::Response::builder()
        .status(status)
        .header(tauri::http::header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(e).unwrap_or_default())
        .unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("walltare.db"))?;
            db::init_schema(&conn)?;
            let cache_dir = dir.join("thumbnails");
            std::fs::create_dir_all(&cache_dir)?;
            app.manage(CacheDir(cache_dir));
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .register_uri_scheme_protocol("wallpaper", |ctx, request| {
            match resolve_image(ctx.app_handle(), request.uri()) {
                Ok(bytes) => image_response(StatusCode::OK, bytes),
                Err(e) => error_response(&e),
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_scan,
            get_pair,
            vote,
            get_stats,
            get_review,
            keep_wallpaper,
            move_wallpaper
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
