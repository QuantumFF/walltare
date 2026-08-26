use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum AppError {
    NotFound(String),
    InvalidTransition(String),
    InvalidPath(String),
    /// A Written path the app cannot read: an unset variable, or a `~` with no
    /// `HOME` behind it. `InvalidPath` keeps meaning the string is well formed
    /// and leads nowhere useful.
    ///
    /// Its message is user-facing copy, because the frontend renders it verbatim
    /// to name the variable the user mistyped.
    InvalidPathSyntax(String),
    BadRequest(String),
    NotEnoughWallpapers(String),
    UnknownWallpaper(String),
    Io(String),
    Db(String),
    Image(String),
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
            AppError::NotFound(m) => ("not_found", m),
            AppError::InvalidTransition(m) => ("invalid_transition", m),
            AppError::InvalidPath(m) => ("invalid_path", m),
            AppError::InvalidPathSyntax(m) => ("invalid_path_syntax", m),
            AppError::BadRequest(m) => ("bad_request", m),
            AppError::NotEnoughWallpapers(m) => ("not_enough_wallpapers", m),
            AppError::UnknownWallpaper(m) => ("unknown_wallpaper", m),
            AppError::Io(m) => ("io", m),
            AppError::Db(m) => ("db", m),
            AppError::Image(m) => ("image", m),
        };
        write!(f, "{kind}: {message}")
    }
}

impl std::error::Error for AppError {}
