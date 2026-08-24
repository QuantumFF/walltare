// PROTOTYPE ONLY. Throwaway code for issue #44. Do not build on this.
//
// Three variants of the shell, the library grid and the lightbox, switchable
// via `?variant=`, on a throwaway `prototype.html` entry. Sub-shape B: none of
// the three pages exists yet, so there is no host page to mount inside.
//
// Runs in a plain browser with `bun run prototype`. No Tauri, no IPC.

import "@/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrototypeBar, useProtoState } from "./harness";
import { InspectorShell } from "./variants/InspectorShell";
import { ListShell } from "./variants/ListShell";
import { ToolbarShell } from "./variants/ToolbarShell";

function Prototype() {
  const [state, patch] = useProtoState();
  const props = {
    page: state.page,
    onPage: (page: typeof state.page) => patch({ page, open: null }),
    data: state.data,
    open: state.open,
    onOpenChange: (open: number | null) => patch({ open }),
  };

  return (
    <>
      {state.variant === "A" && (
        <ToolbarShell {...props} header={state.header} actions={state.actions} />
      )}
      {state.variant === "B" && <InspectorShell {...props} />}
      {state.variant === "C" && <ListShell {...props} />}
      <PrototypeBar state={state} patch={patch} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Prototype />
  </StrictMode>,
);
