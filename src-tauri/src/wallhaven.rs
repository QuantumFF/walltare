//! Wallhaven's API, as the one HTTP client the backend has: requests, JSON, and
//! turning status codes and bodies into errors (ADR 0054).
//!
//! It knows nothing about the library. What Discover does with a Result — the
//! remembered filters, the marks, and later the downloads — sits on top of
//! [`Wallhaven::search`] in [`search`], so the client can be driven against the
//! stub server in `testing.rs` without a database, and the entry point against
//! an in-memory one.
//!
//! Blocking, on `ureq`, and called through `off_main_thread`: nothing else in
//! the backend is async, and a runtime for one client would be the largest
//! dependency in the tree. Nothing is throttled, retried or cached. A 429 is an
//! error that carries the wait, and a cached page would carry stale marks once a
//! download lands.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::settings::{
    self, Categories, DiscoverFilters, Order, Purity, Sorting, TopRange, Vocabulary,
};
use crate::Db;

/// Where Wallhaven's API lives. Tests point a client at the stub instead.
pub const API_BASE: &str = "https://wallhaven.cc/api/v1";

/// How long an API call may take: 10 s to connect, 20 s for the whole answer
/// (ADR 0054). A search that has not answered by then is not going to.
pub const API_TIMEOUTS: Timeouts = Timeouts {
    connect: Duration::from_secs(10),
    total: Duration::from_secs(20),
};

/// The two limits on an API call.
#[derive(Clone, Copy, Debug)]
pub struct Timeouts {
    pub connect: Duration,
    pub total: Duration,
}

/// Wallhaven's 29 colours, the only values its `colors` parameter takes.
/// Anything else is dropped, and the search comes back unfiltered.
const COLOURS: [&str; 29] = [
    "660000", "990000", "cc0000", "cc3333", "ea4c88", "993399", "663399", "333399", "0066cc",
    "0099cc", "66cccc", "77cc33", "669900", "336600", "666600", "999900", "cccc33", "ffff00",
    "ffcc33", "ff9900", "ff6600", "cc6633", "996633", "663300", "000000", "999999", "cccccc",
    "ffffff", "424153",
];

/// The two ratios Wallhaven names rather than spelling as `WxH`.
const NAMED_RATIOS: [&str; 2] = ["landscape", "portrait"];

/// A search, as every parameter Wallhaven's `/search` takes, typed.
///
/// Mirrors the website rather than a subset of it. `q` goes through verbatim,
/// Wallhaven's own syntax included (`+tag`, `-tag`, `id:`, `like:`), and the
/// rest are checked by [`SearchParams::check`] before anything is sent.
#[derive(Clone, Debug, Deserialize)]
pub struct SearchParams {
    #[serde(default)]
    pub q: String,
    pub categories: Categories,
    pub purity: Purity,
    pub sorting: Sorting,
    pub order: Order,
    /// Read only by a toplist, so it is refused with any other sort.
    #[serde(default)]
    pub top_range: Option<TopRange>,
    /// The smallest resolution, as `WxH`. Discover never prefills it from the
    /// Minimum resolution: a Result's size stays the curator's decision.
    #[serde(default)]
    pub atleast: Option<String>,
    /// Exact resolutions, each `WxH`.
    #[serde(default)]
    pub resolutions: Vec<String>,
    /// Ratios, each `WxH` or one of Wallhaven's named ones.
    #[serde(default)]
    pub ratios: Vec<String>,
    /// One of Wallhaven's 29 colours, without the `#`.
    #[serde(default)]
    pub colors: Option<String>,
    #[serde(default)]
    pub page: Option<u32>,
    /// The seed a random sort answered with, so its next page is the same
    /// shuffle.
    #[serde(default)]
    pub seed: Option<String>,
}

impl SearchParams {
    /// Refuses, with `BadRequest`, every value Wallhaven would drop without a
    /// word (ADR 0054).
    ///
    /// Wallhaven fails silently: a malformed ratio is ignored and the search
    /// comes back unfiltered, and the curator reads it as filtered. So the
    /// refusal is here, before any call, where it can be said out loud.
    fn check(&self) -> Result<(), AppError> {
        let refuse = |message: String| Err(AppError::BadRequest(message));
        if self.categories.is_empty() {
            return refuse("a search needs at least one category".to_string());
        }
        if self.purity.is_empty() {
            return refuse("a search needs at least one purity".to_string());
        }
        // NSFW needs a key, and anonymous `purity=001` answers zero Results
        // rather than a 401. The key ticket lifts this once a key is saved; the
        // frontend disables the control anyway, so this is the guard.
        if self.purity.nsfw {
            return refuse("NSFW Results need a Wallhaven API key".to_string());
        }
        if self.top_range.is_some() && self.sorting != Sorting::Toplist {
            return refuse("a toplist range needs the toplist sort".to_string());
        }
        if let Some(atleast) = &self.atleast {
            if !is_size(atleast) {
                return refuse(format!("{atleast:?} is not a resolution, as in 1920x1080"));
            }
        }
        if let Some(resolution) = self.resolutions.iter().find(|r| !is_size(r)) {
            return refuse(format!(
                "{resolution:?} is not a resolution, as in 1920x1080"
            ));
        }
        if let Some(ratio) = self
            .ratios
            .iter()
            .find(|r| !is_size(r) && !NAMED_RATIOS.contains(&r.as_str()))
        {
            return refuse(format!(
                "{ratio:?} is not a ratio; expected one like 16x9, landscape or portrait"
            ));
        }
        if let Some(colour) = &self.colors {
            if !COLOURS.contains(&colour.as_str()) {
                return refuse(format!("{colour:?} is not one of Wallhaven's colours"));
            }
        }
        if self.page == Some(0) {
            return refuse("pages count from 1".to_string());
        }
        if let Some(seed) = &self.seed {
            if seed.len() != 6 || !seed.bytes().all(|b| b.is_ascii_alphanumeric()) {
                return refuse(format!("{seed:?} is not a seed Wallhaven answered with"));
            }
        }
        Ok(())
    }

    /// The query string, as ordered pairs.
    ///
    /// `q` is never first: Cloudflare challenges a request whose query string
    /// starts with `q=like`, so `categories` always leads (ADR 0054). Empty
    /// parameters are left out rather than sent blank.
    fn query(&self) -> Vec<(&'static str, String)> {
        let mut pairs = vec![
            ("categories", self.categories.spelling()),
            ("purity", self.purity.spelling()),
            ("sorting", self.sorting.spelling()),
            ("order", self.order.spelling()),
        ];
        if let Some(range) = self.top_range {
            pairs.push(("topRange", range.spelling()));
        }
        if let Some(atleast) = &self.atleast {
            pairs.push(("atleast", atleast.clone()));
        }
        if !self.resolutions.is_empty() {
            pairs.push(("resolutions", self.resolutions.join(",")));
        }
        if !self.ratios.is_empty() {
            pairs.push(("ratios", self.ratios.join(",")));
        }
        if let Some(colour) = &self.colors {
            pairs.push(("colors", colour.clone()));
        }
        if let Some(page) = self.page {
            pairs.push(("page", page.to_string()));
        }
        if let Some(seed) = &self.seed {
            pairs.push(("seed", seed.clone()));
        }
        if !self.q.is_empty() {
            pairs.push(("q", self.q.clone()));
        }
        pairs
    }
}

/// `WxH`, both numbers above zero: the one shape Wallhaven reads a resolution
/// or an unnamed ratio in.
fn is_size(text: &str) -> bool {
    let number = |part: &str| {
        !part.is_empty()
            && part.bytes().all(|b| b.is_ascii_digit())
            && part.bytes().any(|b| b != b'0')
    };
    text.split_once('x')
        .is_some_and(|(width, height)| number(width) && number(height))
}

/// A Result's thumbnails, as Wallhaven names them. Cards load `large`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Thumbs {
    pub large: String,
    pub original: String,
    pub small: String,
}

/// One Result, as Wallhaven's search record has it, less its `path`.
///
/// The path is the full file's URL, which only a download needs, and the
/// backend resolves that from what it served rather than from anything the
/// webview hands back (ADR 0054). So it stays here, in [`Served`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub url: String,
    pub short_url: String,
    pub views: u64,
    pub favorites: u64,
    pub source: String,
    pub purity: String,
    pub category: String,
    pub dimension_x: u32,
    pub dimension_y: u32,
    pub resolution: String,
    pub ratio: String,
    pub file_size: u64,
    pub file_type: String,
    pub created_at: String,
    pub colors: Vec<String>,
    pub thumbs: Thumbs,
}

/// What the backend keeps of a Result it served, for the download that names
/// it by id.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Served {
    pub path: String,
    pub file_size: u64,
    pub file_type: String,
}

/// Where a page sits among the search's pages.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Meta {
    pub current_page: u32,
    pub last_page: u32,
    pub per_page: u32,
    pub total: u64,
    /// The shuffle a random sort used, for its next page.
    pub seed: Option<String>,
}

/// One page of Results: as the client read them, or marked, as [`search`]
/// answers them.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Page<R = SearchResult> {
    pub results: Vec<R>,
    pub meta: Meta,
}

/// What the library already says about a Result (ADR 0050).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Mark {
    /// No wallpaper carries its id.
    Unmarked,
    /// Some Active or Kept wallpaper carries its id.
    InLibrary,
    /// Only Rejected wallpapers carry its id.
    Rejected,
}

/// A Result and its mark, flattened into one record on the wire.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MarkedResult {
    #[serde(flatten)]
    pub result: SearchResult,
    pub mark: Mark,
}

/// The record as it arrives, `path` included.
#[derive(Deserialize)]
struct Record {
    path: String,
    #[serde(flatten)]
    result: SearchResult,
}

/// The paging meta as it arrives. `per_page` comes as a string on some
/// answers and a number on others.
#[derive(Deserialize)]
struct RawMeta {
    current_page: u32,
    last_page: u32,
    per_page: serde_json::Value,
    total: u64,
    #[serde(default)]
    seed: Option<String>,
}

#[derive(Deserialize)]
struct Answer {
    data: Vec<Record>,
    meta: RawMeta,
}

/// The client, and every Result it has served in this process.
///
/// Managed state, so there is one agent and one map for the app. The map grows
/// for the life of the process and nothing evicts it: a few KB per hundred
/// Results, and a Result from before a restart is one the frontend lost too
/// (ADR 0054).
pub struct Wallhaven {
    agent: ureq::Agent,
    api: String,
    served: Mutex<HashMap<String, Served>>,
}

impl Wallhaven {
    /// A client for the API at `api`, which is [`API_BASE`] outside the tests.
    pub fn new(api: &str, timeouts: Timeouts) -> Self {
        let agent = ureq::Agent::config_builder()
            .timeout_connect(Some(timeouts.connect))
            .timeout_global(Some(timeouts.total))
            // Every status is answered below, where a 429's `Retry-After` and a
            // challenge's HTML can still be read.
            .http_status_as_error(false)
            .user_agent(concat!("walltare/", env!("CARGO_PKG_VERSION")))
            .build()
            .new_agent();
        Self {
            agent,
            api: api.trim_end_matches('/').to_string(),
            served: Mutex::new(HashMap::new()),
        }
    }

    /// One page of a search, after [`SearchParams::check`] has passed it.
    ///
    /// Every Result on the page is recorded as served, so a download can name
    /// it by id.
    pub fn search(&self, params: &SearchParams) -> Result<Page, AppError> {
        params.check()?;
        let mut request = self.agent.get(format!("{}/search", self.api));
        for (key, value) in params.query() {
            request = request.query(key, value);
        }
        let response = request.call().map_err(unreachable)?;
        let answer: Answer = parse(response)?;

        let per_page = match &answer.meta.per_page {
            serde_json::Value::Number(n) => n.as_u64(),
            serde_json::Value::String(s) => s.parse().ok(),
            _ => None,
        }
        .and_then(|n| u32::try_from(n).ok())
        .ok_or_else(|| unexpected("its paging made no sense"))?;

        let mut served = self.served.lock().unwrap_or_else(|p| p.into_inner());
        let results = answer
            .data
            .into_iter()
            .map(|record| {
                served.insert(
                    record.result.id.clone(),
                    Served {
                        path: record.path,
                        file_size: record.result.file_size,
                        file_type: record.result.file_type.clone(),
                    },
                );
                record.result
            })
            .collect();
        Ok(Page {
            results,
            meta: Meta {
                current_page: answer.meta.current_page,
                last_page: answer.meta.last_page,
                per_page,
                total: answer.meta.total,
                seed: answer.meta.seed,
            },
        })
    }

    /// What was served under `id`, or nothing when this process never served
    /// it. `wallhaven_download` resolves an id through this and refuses one it
    /// finds nothing for (#343).
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn served(&self, id: &str) -> Option<Served> {
        self.served
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(id)
            .cloned()
    }
}

/// The search Discover asks for: one page, each Result marked, and the filters
/// it succeeded with remembered.
///
/// The marks come from one id lookup for the whole page, and from rows alone:
/// a search never looks at the disk, so a wallpaper whose file is missing still
/// marks its Result (ADR 0050).
///
/// Only a search that answered is remembered, so a typo or a failed call never
/// becomes the curator's default (ADR 0054). A search with no toplist range
/// keeps the one remembered before it, so a detour through another sort does
/// not lose it.
pub fn search(
    db: &Db,
    client: &Wallhaven,
    params: &SearchParams,
) -> Result<Page<MarkedResult>, AppError> {
    let page = client.search(params)?;
    let ids: Vec<&str> = page.results.iter().map(|r| r.id.as_str()).collect();
    let carriers = db.read(|conn| crate::db::wallhaven_carriers(conn, &ids))?;
    let page = Page {
        results: page
            .results
            .into_iter()
            .map(|result| {
                let mark = match carriers.get(&result.id) {
                    Some(true) => Mark::InLibrary,
                    Some(false) => Mark::Rejected,
                    None => Mark::Unmarked,
                };
                MarkedResult { result, mark }
            })
            .collect(),
        meta: page.meta,
    };
    db.write(|conn| {
        let top_range = match params.top_range {
            Some(range) => range,
            None => settings::discover_filters(conn)?.top_range,
        };
        settings::remember(
            conn,
            &DiscoverFilters {
                purity: params.purity,
                categories: params.categories,
                sorting: params.sorting,
                order: params.order,
                top_range,
            },
        )
    })?;
    Ok(page)
}

/// A call that got no answer at all.
fn unreachable(error: ureq::Error) -> AppError {
    match error {
        ureq::Error::Timeout(_) => {
            AppError::Network("Wallhaven took too long to answer.".to_string())
        }
        other => AppError::Network(format!("Couldn't reach Wallhaven ({other}).")),
    }
}

/// An answer that was not the JSON the API documents.
fn unexpected(what: &str) -> AppError {
    AppError::Network(format!(
        "Wallhaven answered with something unexpected: {what}."
    ))
}

/// An answer, as the JSON it should be or as the error its status and body say
/// it is.
///
/// The order is the order the cases can be told apart in. A 429 carries an
/// HTML body, so it is read off its status before any body is looked at. A
/// Cloudflare challenge says so in `cf-mitigated`, or is an HTML 403: the API
/// answers a refusal of its own as JSON. Every other status is read off the
/// status alone, since Cloudflare's own 5xx pages are HTML too and are still
/// Wallhaven having trouble rather than a challenge.
fn parse<T: serde::de::DeserializeOwned>(
    mut response: ureq::http::Response<ureq::Body>,
) -> Result<T, AppError> {
    let status = response.status().as_u16();
    let header = |name: &str| {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    };

    if status == 429 {
        return Err(AppError::RateLimited(
            match header("retry-after").and_then(|s| s.trim().parse::<u64>().ok()) {
                Some(1) => "Wallhaven's rate limit was reached. Try again in 1 second.".to_string(),
                Some(seconds) => {
                    format!("Wallhaven's rate limit was reached. Try again in {seconds} seconds.")
                }
                None => "Wallhaven's rate limit was reached. Try again in a minute.".to_string(),
            },
        ));
    }

    let html = header("content-type").is_some_and(|t| t.contains("text/html"));
    let challenged = header("cf-mitigated").is_some_and(|v| v.contains("challenge"));
    if challenged || (html && status == 403) {
        return Err(AppError::Network(
            "Wallhaven's Cloudflare check stopped the search.".to_string(),
        ));
    }
    if (500..600).contains(&status) {
        return Err(AppError::Network(format!(
            "Wallhaven is having trouble (HTTP {status})."
        )));
    }
    if status != 200 {
        return Err(AppError::Network(format!(
            "Wallhaven refused the search (HTTP {status})."
        )));
    }

    let body = response
        .body_mut()
        .read_to_string()
        .map_err(|error| match error {
            ureq::Error::Timeout(_) => {
                AppError::Network("Wallhaven took too long to answer.".to_string())
            }
            other => AppError::Network(format!("Couldn't read Wallhaven's answer ({other}).")),
        })?;
    serde_json::from_str(&body).map_err(|_| unexpected("not the JSON its API documents"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{self, Canned};

    /// A search Discover would send first: nothing typed, the default filters.
    fn plain() -> SearchParams {
        let filters = DiscoverFilters::default();
        SearchParams {
            q: String::new(),
            categories: filters.categories,
            purity: filters.purity,
            sorting: filters.sorting,
            order: filters.order,
            top_range: None,
            atleast: None,
            resolutions: Vec::new(),
            ratios: Vec::new(),
            colors: None,
            page: None,
            seed: None,
        }
    }

    fn client(stub: &testing::Stub) -> Wallhaven {
        Wallhaven::new(&stub.base(), API_TIMEOUTS)
    }

    fn db() -> Db {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        Db::new(conn)
    }

    fn record(id: &str) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "url": format!("https://wallhaven.cc/w/{id}"),
            "short_url": format!("https://whvn.cc/{id}"),
            "views": 19368,
            "favorites": 231,
            "source": "",
            "purity": "sfw",
            "category": "anime",
            "dimension_x": 3840,
            "dimension_y": 2160,
            "resolution": "3840x2160",
            "ratio": "1.78",
            "file_size": 10129568,
            "file_type": "image/png",
            "created_at": "2026-09-02 17:01:46",
            "colors": ["#000000", "#424153"],
            "path": format!("https://w.wallhaven.cc/full/{}/wallhaven-{id}.png", &id[..2]),
            "thumbs": {
                "large": format!("https://th.wallhaven.cc/lg/{}/{id}.jpg", &id[..2]),
                "original": format!("https://th.wallhaven.cc/orig/{}/{id}.jpg", &id[..2]),
                "small": format!("https://th.wallhaven.cc/small/{}/{id}.jpg", &id[..2]),
            },
        })
    }

    fn page_of(ids: &[&str], current: u32, last: u32) -> Canned {
        Canned::json(serde_json::json!({
            "data": ids.iter().map(|id| record(id)).collect::<Vec<_>>(),
            // A string, the way Wallhaven sends it on some answers.
            "meta": { "current_page": current, "last_page": last, "per_page": "24", "total": 846, "query": null, "seed": null },
        }))
    }

    fn refusal(params: SearchParams) -> String {
        let stub = testing::stub(vec![]);
        match client(&stub).search(&params) {
            Err(AppError::BadRequest(message)) => {
                assert!(stub.requests().is_empty(), "a refusal sent nothing");
                message
            }
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn a_search_answers_the_results_less_their_path_and_the_paging() {
        let stub = testing::stub(vec![page_of(&["qrow67", "jedzym"], 1, 36)]);

        let page = client(&stub).search(&plain()).unwrap();

        assert_eq!(page.results.len(), 2);
        assert_eq!(page.results[0].id, "qrow67");
        assert_eq!(
            page.results[0].thumbs.large,
            "https://th.wallhaven.cc/lg/qr/qrow67.jpg"
        );
        assert_eq!(page.results[0].file_size, 10129568);
        assert_eq!(
            page.meta,
            Meta {
                current_page: 1,
                last_page: 36,
                per_page: 24,
                total: 846,
                seed: None,
            }
        );
        let json = serde_json::to_value(&page).unwrap();
        assert!(json["results"][0].get("path").is_none(), "{json}");
        assert_eq!(json["results"][0]["resolution"], "3840x2160");
    }

    #[test]
    fn every_result_served_is_recorded_for_the_life_of_the_client() {
        let stub = testing::stub(vec![page_of(&["qrow67"], 1, 2), page_of(&["jedzym"], 2, 2)]);
        let wallhaven = client(&stub);

        wallhaven.search(&plain()).unwrap();
        wallhaven
            .search(&SearchParams {
                page: Some(2),
                ..plain()
            })
            .unwrap();

        assert_eq!(
            wallhaven.served("qrow67"),
            Some(Served {
                path: "https://w.wallhaven.cc/full/qr/wallhaven-qrow67.png".to_string(),
                file_size: 10129568,
                file_type: "image/png".to_string(),
            })
        );
        assert!(wallhaven.served("jedzym").is_some());
        assert_eq!(wallhaven.served("never1"), None);
    }

    #[test]
    fn the_query_string_carries_every_parameter_and_never_starts_with_q() {
        let stub = testing::stub(vec![page_of(&[], 1, 1)]);

        client(&stub)
            .search(&SearchParams {
                q: "like:qrow67 +tag".to_string(),
                sorting: Sorting::Toplist,
                top_range: Some(TopRange::OneYear),
                atleast: Some("2560x1440".to_string()),
                resolutions: vec!["3840x2160".to_string(), "2560x1440".to_string()],
                ratios: vec!["16x9".to_string(), "landscape".to_string()],
                colors: Some("424153".to_string()),
                page: Some(3),
                seed: Some("aB3dE9".to_string()),
                ..plain()
            })
            .unwrap();

        let request = &stub.requests()[0];
        let target = request.target();
        assert!(target.starts_with("/search?"), "{target}");
        let query = target.split_once('?').unwrap().1;
        assert!(!query.starts_with("q="), "{query}");
        let pairs: HashMap<String, String> = query
            .split('&')
            .map(|pair| {
                let (k, v) = pair.split_once('=').unwrap();
                (k.to_string(), testing::percent_decoded(v))
            })
            .collect();
        assert_eq!(pairs["categories"], "111");
        assert_eq!(pairs["purity"], "100");
        assert_eq!(pairs["sorting"], "toplist");
        assert_eq!(pairs["order"], "desc");
        assert_eq!(pairs["topRange"], "1y");
        assert_eq!(pairs["atleast"], "2560x1440");
        assert_eq!(pairs["resolutions"], "3840x2160,2560x1440");
        assert_eq!(pairs["ratios"], "16x9,landscape");
        assert_eq!(pairs["colors"], "424153");
        assert_eq!(pairs["page"], "3");
        assert_eq!(pairs["seed"], "aB3dE9");
        assert_eq!(pairs["q"], "like:qrow67 +tag");
    }

    #[test]
    fn an_empty_query_sends_no_q_and_no_optional_parameters() {
        let stub = testing::stub(vec![page_of(&[], 1, 1)]);

        client(&stub).search(&plain()).unwrap();

        assert_eq!(
            stub.requests()[0].target(),
            "/search?categories=111&purity=100&sorting=date_added&order=desc"
        );
    }

    #[test]
    fn a_ratio_or_resolution_wallhaven_would_drop_is_refused() {
        for ratio in ["16:9", "16x", "x9", "0x9", "wide", "16x9 "] {
            refusal(SearchParams {
                ratios: vec![ratio.to_string()],
                ..plain()
            });
        }
        for size in ["1920*1080", "1920x", "landscape"] {
            refusal(SearchParams {
                resolutions: vec![size.to_string()],
                ..plain()
            });
            refusal(SearchParams {
                atleast: Some(size.to_string()),
                ..plain()
            });
        }
    }

    #[test]
    fn a_colour_outside_wallhavens_29_is_refused() {
        for colour in ["#424153", "424154", "FFFFFF", ""] {
            refusal(SearchParams {
                colors: Some(colour.to_string()),
                ..plain()
            });
        }
    }

    #[test]
    fn a_toplist_range_without_the_toplist_sort_is_refused() {
        let message = refusal(SearchParams {
            sorting: Sorting::Hot,
            top_range: Some(TopRange::OneWeek),
            ..plain()
        });
        assert!(message.contains("toplist"), "{message}");
    }

    #[test]
    fn nsfw_is_refused_without_a_key() {
        let message = refusal(SearchParams {
            purity: Purity {
                sfw: true,
                sketchy: false,
                nsfw: true,
            },
            ..plain()
        });
        assert!(message.contains("API key"), "{message}");
    }

    #[test]
    fn an_empty_set_of_categories_or_purities_and_a_bad_page_or_seed_are_refused() {
        refusal(SearchParams {
            categories: Categories {
                general: false,
                anime: false,
                people: false,
            },
            ..plain()
        });
        refusal(SearchParams {
            purity: Purity {
                sfw: false,
                sketchy: false,
                nsfw: false,
            },
            ..plain()
        });
        refusal(SearchParams {
            page: Some(0),
            ..plain()
        });
        refusal(SearchParams {
            seed: Some("abc".to_string()),
            ..plain()
        });
    }

    #[test]
    fn a_429_is_rate_limited_with_the_seconds_to_wait() {
        let stub = testing::stub(vec![
            Canned::html(429, "<html>Too Many Requests</html>").header("Retry-After", "37")
        ]);

        let err = client(&stub).search(&plain()).unwrap_err();

        let AppError::RateLimited(message) = err else {
            panic!("{err:?}");
        };
        assert!(message.contains("37 seconds"), "{message}");
    }

    #[test]
    fn a_5xx_is_a_network_error_naming_the_status() {
        let stub = testing::stub(vec![Canned::json_status(503, serde_json::json!({}))]);

        let err = client(&stub).search(&plain()).unwrap_err();

        let AppError::Network(message) = err else {
            panic!("{err:?}");
        };
        assert!(message.contains("503"), "{message}");
    }

    #[test]
    fn a_cloudflare_challenge_is_a_network_error_saying_so() {
        let stub = testing::stub(vec![Canned::html(403, "<html>Just a moment...</html>")]);

        let err = client(&stub).search(&plain()).unwrap_err();

        let AppError::Network(message) = err else {
            panic!("{err:?}");
        };
        assert!(message.contains("Cloudflare"), "{message}");
    }

    #[test]
    fn a_challenge_named_in_its_header_is_the_cloudflare_error_at_any_status() {
        let stub =
            testing::stub(vec![Canned::html(503, "<html>Just a moment...</html>")
                .header("cf-mitigated", "challenge")]);

        let err = client(&stub).search(&plain()).unwrap_err();

        let AppError::Network(message) = err else {
            panic!("{err:?}");
        };
        assert!(message.contains("Cloudflare"), "{message}");
    }

    #[test]
    fn cloudflares_own_html_5xx_page_is_wallhaven_having_trouble() {
        let stub = testing::stub(vec![Canned::html(522, "<html>Connection timed out</html>")]);

        let err = client(&stub).search(&plain()).unwrap_err();

        let AppError::Network(message) = err else {
            panic!("{err:?}");
        };
        assert!(message.contains("HTTP 522"), "{message}");
        assert!(!message.contains("Cloudflare"), "{message}");
    }

    #[test]
    fn an_html_404_is_a_refusal_naming_its_status_and_not_a_challenge() {
        let stub = testing::stub(vec![Canned::html(404, "<html>Not Found</html>")]);

        let err = client(&stub).search(&plain()).unwrap_err();

        let AppError::Network(message) = err else {
            panic!("{err:?}");
        };
        assert!(message.contains("HTTP 404"), "{message}");
        assert!(!message.contains("Cloudflare"), "{message}");
    }

    #[test]
    fn a_body_that_is_not_the_documented_json_is_a_network_error() {
        let stub = testing::stub(vec![Canned::json(serde_json::json!({ "error": "nope" }))]);

        let err = client(&stub).search(&plain()).unwrap_err();

        let AppError::Network(message) = err else {
            panic!("{err:?}");
        };
        assert!(message.contains("unexpected"), "{message}");
    }

    #[test]
    fn an_answer_that_never_comes_is_a_network_error_saying_it_took_too_long() {
        let stub = testing::stub(vec![page_of(&[], 1, 1).after(Duration::from_millis(800))]);
        let wallhaven = Wallhaven::new(
            &stub.base(),
            Timeouts {
                connect: Duration::from_millis(200),
                total: Duration::from_millis(200),
            },
        );

        let err = wallhaven.search(&plain()).unwrap_err();

        let AppError::Network(message) = err else {
            panic!("{err:?}");
        };
        assert!(message.contains("too long"), "{message}");
    }

    #[test]
    fn nothing_listening_is_a_network_error() {
        let stub = testing::stub(vec![]);
        let base = stub.base();
        drop(stub);
        let wallhaven = Wallhaven::new(&base, API_TIMEOUTS);

        let err = wallhaven.search(&plain()).unwrap_err();

        assert!(matches!(err, AppError::Network(_)), "{err:?}");
    }

    #[test]
    fn a_successful_search_remembers_its_five_filters() {
        let db = db();
        let stub = testing::stub(vec![page_of(&["qrow67"], 1, 1)]);
        let params = SearchParams {
            q: "forest".to_string(),
            categories: Categories {
                general: true,
                anime: false,
                people: false,
            },
            purity: Purity {
                sfw: true,
                sketchy: true,
                nsfw: false,
            },
            sorting: Sorting::Toplist,
            order: Order::Asc,
            top_range: Some(TopRange::ThreeMonths),
            ratios: vec!["21x9".to_string()],
            ..plain()
        };

        search(&db, &client(&stub), &params).unwrap();

        let filters = db.read(settings::discover_filters).unwrap();
        assert_eq!(
            filters,
            DiscoverFilters {
                purity: params.purity,
                categories: params.categories,
                sorting: Sorting::Toplist,
                order: Order::Asc,
                top_range: TopRange::ThreeMonths,
            }
        );
    }

    #[test]
    fn a_search_with_no_toplist_range_keeps_the_one_remembered() {
        let db = db();
        let stub = testing::stub(vec![page_of(&[], 1, 1), page_of(&[], 1, 1)]);
        let wallhaven = client(&stub);

        search(
            &db,
            &wallhaven,
            &SearchParams {
                sorting: Sorting::Toplist,
                top_range: Some(TopRange::OneWeek),
                ..plain()
            },
        )
        .unwrap();
        search(
            &db,
            &wallhaven,
            &SearchParams {
                sorting: Sorting::Views,
                ..plain()
            },
        )
        .unwrap();

        let filters = db.read(settings::discover_filters).unwrap();
        assert_eq!(filters.sorting, Sorting::Views);
        assert_eq!(filters.top_range, TopRange::OneWeek);
    }

    #[test]
    fn a_failed_or_refused_search_remembers_nothing() {
        let db = db();
        let stub = testing::stub(vec![Canned::json_status(502, serde_json::json!({}))]);
        let wallhaven = client(&stub);
        let hot = SearchParams {
            sorting: Sorting::Hot,
            ..plain()
        };

        assert!(search(&db, &wallhaven, &hot).is_err());
        assert!(search(
            &db,
            &wallhaven,
            &SearchParams {
                ratios: vec!["16:9".to_string()],
                ..hot.clone()
            }
        )
        .is_err());

        assert_eq!(
            db.read(settings::discover_filters).unwrap(),
            DiscoverFilters::default()
        );
    }

    fn seed_carrier(db: &Db, path: &str, status: &str) {
        db.write(|conn| testing::seed_wallhaven_wallpaper(conn, path, status));
    }

    fn marks(page: &Page<MarkedResult>) -> Vec<(&str, Mark)> {
        page.results
            .iter()
            .map(|r| (r.result.id.as_str(), r.mark))
            .collect()
    }

    #[test]
    fn a_search_marks_each_result_by_the_wallpapers_carrying_its_id() {
        // ADR 0050's precedence, against a row of every Status: In library when
        // any Active or Kept wallpaper carries the id, Rejected when only
        // Rejected ones do, and nothing otherwise. The rows point at files that
        // do not exist, which is the point: a search never looks at the disk,
        // so a missing file counts like any other.
        let db = db();
        seed_carrier(&db, "/gone/wallhaven-active.jpg", "active");
        seed_carrier(&db, "/w/wallhaven-kept01.png", "kept");
        seed_carrier(&db, "/w/rejected/wallhaven-reject.jpg", "rejected");
        seed_carrier(&db, "/w/rejected/wallhaven-shared.jpg", "rejected");
        seed_carrier(&db, "/w/wallhaven-shared (2).jpg", "active");
        seed_carrier(&db, "/w/rejected/wallhaven-twice1.jpg", "rejected");
        seed_carrier(&db, "/w/rejected/wallhaven-twice1 (2).jpg", "rejected");
        let stub = testing::stub(vec![page_of(
            &["active", "kept01", "reject", "shared", "twice1", "nobody"],
            1,
            1,
        )]);

        let page = search(&db, &client(&stub), &plain()).unwrap();

        assert_eq!(
            marks(&page),
            vec![
                ("active", Mark::InLibrary),
                ("kept01", Mark::InLibrary),
                ("reject", Mark::Rejected),
                ("shared", Mark::InLibrary),
                ("twice1", Mark::Rejected),
                ("nobody", Mark::Unmarked),
            ]
        );
    }

    #[test]
    fn a_mark_crosses_the_ipc_beside_the_record_it_marks() {
        let db = db();
        seed_carrier(&db, "/w/wallhaven-qrow67.png", "kept");
        let stub = testing::stub(vec![page_of(&["qrow67", "jedzym"], 1, 1)]);

        let page = search(&db, &client(&stub), &plain()).unwrap();

        let json = serde_json::to_value(&page).unwrap();
        assert_eq!(json["results"][0]["id"], "qrow67");
        assert_eq!(json["results"][0]["mark"], "in_library");
        assert_eq!(json["results"][0]["resolution"], "3840x2160");
        assert!(json["results"][0].get("path").is_none(), "{json}");
        assert_eq!(json["results"][1]["mark"], "unmarked");
        assert_eq!(serde_json::to_value(Mark::Rejected).unwrap(), "rejected");
        assert_eq!(json["meta"]["last_page"], 1);
    }

    #[test]
    fn search_params_arrive_as_client_ts_sends_them() {
        let params: SearchParams = serde_json::from_value(serde_json::json!({
            "q": "forest",
            "categories": { "general": true, "anime": true, "people": false },
            "purity": { "sfw": true, "sketchy": false, "nsfw": false },
            "sorting": "toplist",
            "order": "desc",
            "top_range": "1M",
            "ratios": ["16x9"],
            "page": 2,
        }))
        .unwrap();

        assert_eq!(params.sorting, Sorting::Toplist);
        assert_eq!(params.top_range, Some(TopRange::OneMonth));
        assert_eq!(params.ratios, ["16x9"]);
        assert_eq!(params.page, Some(2));
        assert!(params.atleast.is_none() && params.colors.is_none());
    }
}
