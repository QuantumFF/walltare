/**
 * What the frontend reads off a path string, for the paths the backend hands
 * back rather than the ones it stores.
 *
 * Both file-moving commands answer with the absolute path the file landed at,
 * and neither answers with the row it wrote. The two things a caller then wants
 * from that string are here, in one copy, because the callers are a toast
 * deciding whether a rename happened and the four publishers building a patch
 * for the row that moved (ADR 0015 as amended by #141) — and a second copy is
 * how those two come to disagree about a path with no separator in it.
 *
 * POSIX separators only. The backend is `std::path` on Linux and the paths that
 * reach here are its own output; nothing on this side parses what a curator
 * typed, which is `expand_path`'s (ADR 0018).
 */

/**
 * The last segment of a path, which is the name the file ended up with.
 *
 * This is how the backend derives the `filename` column it stores — the
 * basename of whatever `unique_destination` resolved — so deriving it a second
 * time from the path that command answered with cannot disagree with the
 * database (ADR 0003).
 */
export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
