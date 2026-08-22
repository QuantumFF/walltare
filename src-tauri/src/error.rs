use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum AppError {
    InvalidPath(String),
    NotEnoughWallpapers(String),
    UnknownWallpaper(String),
    Io(String),
    Db(String),
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Db(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.to_string())
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let (kind, message) = match self {
            AppError::InvalidPath(m) => ("invalid_path", m),
            AppError::NotEnoughWallpapers(m) => ("not_enough_wallpapers", m),
            AppError::UnknownWallpaper(m) => ("unknown_wallpaper", m),
            AppError::Io(m) => ("io", m),
            AppError::Db(m) => ("db", m),
        };
        write!(f, "{kind}: {message}")
    }
}

impl std::error::Error for AppError {}
