//! Test helpers that more than one test module needs.
//!
//! The rule is deliberately narrow: a helper belongs here once a second test
//! module wants it, and not before. It is a place for shared helpers rather
//! than a place for helpers, so nothing arrives here on the grounds that it
//! might be shared later (ADR 0030).
//!
//! It exists because `db.rs`'s tests and `soft_reject.rs`'s tests seed and read
//! the same rows: the Soft reject is a transition on a wallpaper row, so the
//! module that performs it and the module that defines the row ask the database
//! the same questions. Duplicating these would be drift with a start date.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::db::{self, ListOrdering, StatusFilter};

/// A wallpaper row with no file behind it, for the tests that never touch disk.
pub(crate) fn seed_wallpaper(conn: &Connection, path: &str, status: &str, mu: f64) -> i64 {
    conn.execute(
        "INSERT INTO wallpapers (filename, path, status, rating_mu) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![path.rsplit('/').next().unwrap(), path, status, mu],
    )
    .unwrap();
    conn.last_insert_rowid()
}

/// A wallpaper whose file exists, seeded through the same insert a scan uses.
/// The file is empty, which is enough for anything that only moves it.
pub(crate) fn seed_real_wallpaper(conn: &Connection, dir: &Path, name: &str) -> i64 {
    let path = dir.join(name);
    std::fs::File::create(&path).unwrap();
    db::insert_new_wallpapers(conn, &[path]).unwrap();
    conn.last_insert_rowid()
}

/// A library folder holding one wallpaper, and the Origin string a reject of it
/// records. Every restore test starts here, and so does the un-keep test that
/// has to get a wallpaper genuinely rejected first.
pub(crate) fn seed_for_restore(conn: &Connection, root: &Path, name: &str) -> (i64, PathBuf) {
    let library = root.join("library");
    std::fs::create_dir_all(&library).unwrap();
    let id = seed_real_wallpaper(conn, &library, name);
    (id, library.join(name))
}

pub(crate) fn add_comparison(conn: &Connection, winner_id: i64, loser_id: i64) {
    conn.execute(
        "INSERT INTO comparisons (winner_id, loser_id, voted_at) VALUES (?1, ?2, unixepoch())",
        rusqlite::params![winner_id, loser_id],
    )
    .unwrap();
}

pub(crate) fn origin_path_of(conn: &Connection, id: i64) -> Option<String> {
    conn.query_row(
        "SELECT origin_path FROM wallpapers WHERE id = ?1",
        rusqlite::params![id],
        |row| row.get(0),
    )
    .unwrap()
}

/// A wallpaper's recorded pixel dimensions, `(None, None)` until something has
/// read them off the file (ADR 0044).
///
/// Here because both the scan and the pre-generation pass write them, and their
/// tests ask the same question of the same two columns.
pub(crate) fn dimensions_of(conn: &Connection, id: i64) -> (Option<i64>, Option<i64>) {
    conn.query_row(
        "SELECT width, height FROM wallpapers WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .unwrap()
}

pub(crate) fn status_of(conn: &Connection, id: i64) -> String {
    conn.query_row(
        "SELECT status FROM wallpapers WHERE id = ?1",
        rusqlite::params![id],
        |row| row.get(0),
    )
    .unwrap()
}

pub(crate) fn row_status_and_path(conn: &Connection, id: i64) -> (String, String) {
    conn.query_row(
        "SELECT status, path FROM wallpapers WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .unwrap()
}

pub(crate) fn count_wallpapers(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM wallpapers", [], |row| row.get(0))
        .unwrap()
}

pub(crate) fn count_comparisons(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM comparisons", [], |row| row.get(0))
        .unwrap()
}

/// The listing Review asks for, as ids: what the curator's worklist holds after
/// a transition has moved a wallpaper into or out of it.
pub(crate) fn review_ids(conn: &Connection) -> Vec<i64> {
    db::list_wallpapers(conn, StatusFilter::Active, ListOrdering::ScoreAsc, Some(50))
        .unwrap()
        .iter()
        .map(|w| w.id)
        .collect()
}

/// An answer the stub server gives: a status, its headers and a body, and how
/// long to sit on it first.
///
/// Canned rather than computed, because what is worth testing on the other
/// side is the code that reads a real HTTP answer — the 429's HTML, the
/// challenge's headers, a body that is not JSON — and a fake transport would
/// skip exactly that (ADR 0054).
pub(crate) struct Canned {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
    delay: Option<std::time::Duration>,
}

impl Canned {
    /// A 200 carrying `body` as JSON.
    pub(crate) fn json(body: serde_json::Value) -> Self {
        Self::json_status(200, body)
    }

    /// Any status carrying `body` as JSON.
    pub(crate) fn json_status(status: u16, body: serde_json::Value) -> Self {
        Self {
            status,
            headers: vec![("Content-Type".to_string(), "application/json".to_string())],
            body: body.to_string(),
            delay: None,
        }
    }

    /// Any status carrying an HTML page, which is how Wallhaven's rate limit
    /// and Cloudflare's challenge both answer.
    pub(crate) fn html(status: u16, body: &str) -> Self {
        Self {
            status,
            headers: vec![(
                "Content-Type".to_string(),
                "text/html; charset=UTF-8".to_string(),
            )],
            body: body.to_string(),
            delay: None,
        }
    }

    pub(crate) fn header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }

    /// Waits `delay` before answering, for a client's timeout to run out.
    pub(crate) fn after(mut self, delay: std::time::Duration) -> Self {
        self.delay = Some(delay);
        self
    }
}

/// One request the stub received: its request line and its headers, as sent.
#[derive(Clone, Debug)]
pub(crate) struct Received {
    pub line: String,
    #[allow(dead_code)] // For the key ticket's "sent on API calls only".
    pub headers: Vec<(String, String)>,
}

impl Received {
    /// The path and query the request asked for, exactly as it crossed.
    pub(crate) fn target(&self) -> &str {
        self.line.split(' ').nth(1).unwrap_or("")
    }
}

/// An HTTP server on a loopback port, in this process, answering each
/// connection with the next [`Canned`] in turn and recording what it was
/// asked.
///
/// On `std::net::TcpListener` rather than a server crate, because a stub that
/// reads a request head and writes an answer is all a client test needs. One
/// answer per connection, with `Connection: close`, so no keep-alive can carry a
/// request past the answer meant for it. A request after the last canned answer
/// gets a 500 rather than a hang.
///
/// Here rather than in `wallhaven.rs`'s tests because ADR 0054 puts it here:
/// the `download` module's tests are its second caller, against the image
/// hosts.
pub(crate) struct Stub {
    port: u16,
    requests: std::sync::Arc<std::sync::Mutex<Vec<Received>>>,
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

pub(crate) fn stub(answers: Vec<Canned>) -> Stub {
    use std::io::{BufRead, BufReader, Write};
    use std::sync::atomic::Ordering;

    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let requests = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    let thread = {
        let requests = requests.clone();
        let stop = stop.clone();
        std::thread::spawn(move || {
            let mut answers = answers.into_iter();
            for stream in listener.incoming() {
                if stop.load(Ordering::SeqCst) {
                    return;
                }
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() {
                    continue;
                }
                let mut headers = Vec::new();
                loop {
                    let mut header = String::new();
                    if reader.read_line(&mut header).unwrap_or(0) == 0 {
                        break;
                    }
                    let header = header.trim_end();
                    if header.is_empty() {
                        break;
                    }
                    if let Some((name, value)) = header.split_once(':') {
                        headers.push((name.trim().to_lowercase(), value.trim().to_string()));
                    }
                }
                requests.lock().unwrap().push(Received {
                    line: line.trim_end().to_string(),
                    headers,
                });

                let answer = answers.next().unwrap_or_else(|| Canned {
                    status: 500,
                    headers: Vec::new(),
                    body: "the stub has no answer left".to_string(),
                    delay: None,
                });
                if let Some(delay) = answer.delay {
                    std::thread::sleep(delay);
                }
                let mut head = format!("HTTP/1.1 {} Stub\r\n", answer.status);
                for (name, value) in &answer.headers {
                    head.push_str(&format!("{name}: {value}\r\n"));
                }
                head.push_str(&format!(
                    "Content-Length: {}\r\nConnection: close\r\n\r\n",
                    answer.body.len()
                ));
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(answer.body.as_bytes());
            }
        })
    };

    Stub {
        port,
        requests,
        stop,
        thread: Some(thread),
    }
}

impl Stub {
    /// The base URL a client is constructed with to reach this stub.
    pub(crate) fn base(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// Every request received so far, in order.
    pub(crate) fn requests(&self) -> Vec<Received> {
        self.requests.lock().unwrap().clone()
    }
}

impl Drop for Stub {
    /// Stops listening, so the port is closed once the stub is gone.
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
        // Wakes the accept loop, which sees the flag and returns.
        let _ = std::net::TcpStream::connect(("127.0.0.1", self.port));
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// A query-string value with its percent escapes and `+` spaces undone.
pub(crate) fn percent_decoded(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        match bytes[at] {
            b'%' if at + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[at + 1..at + 3]).unwrap();
                out.push(u8::from_str_radix(hex, 16).unwrap());
                at += 3;
            }
            b'+' => {
                out.push(b' ');
                at += 1;
            }
            byte => {
                out.push(byte);
                at += 1;
            }
        }
    }
    String::from_utf8(out).unwrap()
}
