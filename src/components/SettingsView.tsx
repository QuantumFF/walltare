import { PageBar } from "@/components/PageBar";
import { ScanView } from "@/components/ScanView";
import { useApp } from "@/context/AppContext";
import { AlertTriangle } from "lucide-react";

/**
 * Interim, and it is meant to read as one. #77 builds the Settings page — its
 * sections, its fields, its own Escape handling — and deletes `ScanView.tsx`,
 * whose folder field becomes the Library root and whose progress reporting
 * becomes ADR 0021's pinned toast.
 *
 * Until then Settings hosts the scan screen unchanged, because folding scan into
 * Settings is what deleted `scan` from the view union: without this there is no
 * way to fill an empty library at all.
 *
 * Settings is the one destination the shell unmounts, so its fields re-read the
 * store on arrival rather than holding a stale copy of it (ADR 0015).
 */
export function SettingsView() {
  const { bootNotice } = useApp();

  return (
    <>
      <PageBar>
        <span className="font-medium">Settings</span>
      </PageBar>

      {/* Why boot opened this page, when boot is what opened it. The two rows of
          ADR 0015's boot table that land here are a first run and a library that
          would not read, and they are different problems: one is an invitation
          to scan, the other is a fault the curator has to fix outside the app.
          Telling the second one it has never scanned is the bug this replaces.
          #77 folds these into the page's own layout. */}
      {bootNotice?.kind === "first_run" && (
        <div
          role="status"
          className="mx-auto mt-8 w-full max-w-lg rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
        >
          Your library is empty. Point walltare at a folder of wallpapers below,
          and every one it finds becomes Active and ready to rank.
        </div>
      )}

      {bootNotice?.kind === "unreadable_library" && (
        <div
          role="alert"
          className="mx-auto mt-8 flex w-full max-w-lg gap-3 rounded-lg border border-destructive/40 bg-card px-4 py-3 text-sm"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
            aria-hidden
          />
          <div className="space-y-1">
            <p className="font-medium text-foreground">
              walltare couldn&apos;t read your library.
            </p>
            {/* The backend's own message, verbatim. It is the only account of
                the fault there is, and a canned sentence in front of it would
                hide which file or lock is the problem. */}
            <p className="text-muted-foreground">{bootNotice.message}</p>
            <p className="text-muted-foreground">
              Your wallpapers are still where they were. Nothing here has been
              lost, and a scan will not fix it.
            </p>
          </div>
        </div>
      )}

      <ScanView />
    </>
  );
}
