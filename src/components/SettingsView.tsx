import { PageBar } from "@/components/PageBar";
import { ScanView } from "@/components/ScanView";

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
  return (
    <>
      <PageBar>
        <span className="font-medium">Settings</span>
      </PageBar>

      <ScanView />
    </>
  );
}
