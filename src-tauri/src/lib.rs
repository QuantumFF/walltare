mod db;
mod error;
pub mod ranking; // consumed by later voting slices; kept Tauri-free
mod scanner;
mod voting;

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("walltare.db"))?;
            db::init_schema(&conn)?;
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_scan, get_pair, vote, get_stats
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
