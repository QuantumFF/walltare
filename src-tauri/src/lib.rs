mod db;
mod error;
mod scanner;

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
            start_scan,
            get_review,
            move_wallpaper
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
