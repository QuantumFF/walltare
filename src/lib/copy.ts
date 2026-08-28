/**
 * How the app writes a number into a sentence.
 *
 * Two surfaces print the same numbers about the same work: the shell's report of
 * a scan or a pass, and the Settings page's Thumbnails line. ADR 0021 put
 * `240 of 1,204` in the toast precisely because ADR 0020 already prints those
 * words in that section — "one fact, one phrasing, in both places" — so the
 * phrasing lives here rather than once per caller, where the two would eventually
 * disagree about a comma.
 *
 * Nothing here is a component and nothing here reaches the backend, which is why
 * it sits beside `client.ts` rather than inside either of the files that call it.
 */

/**
 * A count as the copy writes it, grouped in threes: `1,536` and not `1536`.
 *
 * Grouped here rather than through `toLocaleString`, which reads the host's
 * locale: the app ships one language, and a German desktop would put `1.536` in
 * one of those two sentences while the other one said `1,536`.
 */
export function grouped(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** `1,536 files`, and `1 file`, so the noun agrees with the count in front of it. */
export function counted(count: number, noun: string): string {
  return `${grouped(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The units a cache size is written in, smallest first. `KB` rather than SI's
 * `kB`, which is how every document that already states a number about this
 * cache spells it (ADR 0012, ADR 0020).
 */
const UNITS = ["B", "KB", "MB", "GB", "TB"];

/**
 * A byte count as the copy writes it: `48 MB`, `1.6 MB`, `0 B`.
 *
 * **Powers of 1,000, not of 1,024**, and so `MB` rather than `MiB`. Every number
 * already written down about this cache is decimal: ADR 0012 measured 120 medium
 * thumbnails at 46MB and read 383KB per file off it, which is 46,000,000 ÷ 120,
 * and its 830MB projection is 2,000 × 414KB the same way. Reading those same
 * bytes in binary would print `44 MB` under a heading whose own ADR says 46, and
 * the sizing argument for the whole cache would stop adding up on screen. What
 * that costs is `du -h`, which is binary and is the one place a curator could
 * cross-check this line; a 5% disagreement with one shell command is cheaper than
 * disagreeing with every decision already recorded about this directory.
 *
 * One decimal below ten and none above, which is what makes ADR 0012's own two
 * readings come out as themselves — `1.6 MB` for the smalls, `46 MB` for the
 * mediums — while keeping the line short at the sizes that matter. Bytes are
 * whole, because there is nothing useful left to say after the decimal point down
 * there.
 */
export function bytes(count: number): string {
  let value = count;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  // Rounded through `Number` so a trailing zero goes: `1 MB` rather than
  // `1.0 MB`, and ADR 0012's "2GB for 5000 wallpapers" comes out as `2 GB`.
  const rounded =
    unit === 0 || value >= 10 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${UNITS[unit]}`;
}
