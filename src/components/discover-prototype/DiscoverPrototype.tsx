// PROTOTYPE — throwaway. Three variants of the Discover page (#324), switchable
// via `?variant=A|B|C` and the pink bar at the bottom (Alt+←/→). Search results
// are a real Wallhaven fixture; downloads are a fake queue. Nothing is written.
import { useMemo } from "react";
import {
  FakeDownloadToast,
  PrototypeSwitcher,
  useFakeDownloads,
  useFakeSearch,
  useFilters,
  usePicks,
  useVariant,
  type DownloadState,
  type Result,
} from "./shared";
import { VariantA } from "./VariantA";
import { VariantB } from "./VariantB";
import { VariantC } from "./VariantC";

export type DiscoverProps = ReturnType<typeof useFilters> & {
  search: ReturnType<typeof useFakeSearch>;
  downloads: ReturnType<typeof useFakeDownloads>;
  picks: ReturnType<typeof usePicks>;
  log: { r: Result; state: DownloadState }[];
};

export function DiscoverPrototype() {
  const { variant, go } = useVariant();
  const filters = useFilters();
  const search = useFakeSearch(
    filters.filters,
    variant === "B" ? "page" : "append",
  );
  const downloads = useFakeDownloads();
  const picks = usePicks();

  // Everything that was ever queued, newest first, for B's Downloads list.
  const seen = useMemo(() => new Map<string, Result>(), []);
  for (const r of search.results) seen.set(r.id, r);
  const log = Object.entries(downloads.states)
    .map(([id, state]) => ({ r: seen.get(id)!, state }))
    .filter((x) => x.r)
    .reverse();

  const props: DiscoverProps = { ...filters, search, downloads, picks, log };
  const b = downloads.batch;
  const state = [
    `ratio=${filters.filters.ratio ?? "any"}`,
    `sort=${filters.filters.sorting}`,
    `page=${search.page}`,
    `${search.results.length} loaded`,
    `${picks.picks.length} picked`,
    b ? `batch ${b.landed + b.failed}/${b.total}${b.running ? "…" : ""}` : "no batch",
  ].join(" · ");

  return (
    <>
      <h1 className="sr-only">Discover</h1>
      {variant === "A" && <VariantA {...props} />}
      {variant === "B" && <VariantB {...props} />}
      {variant === "C" && <VariantC {...props} />}
      <FakeDownloadToast batch={downloads.batch} onDismiss={downloads.dismiss} />
      <PrototypeSwitcher variant={variant} go={go} state={state} />
    </>
  );
}
