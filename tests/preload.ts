import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { registerIpcMocks } from "./ipc-mocks";

GlobalRegistrator.register();
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Point the app's Tauri imports (via src/lib/client.ts, the single seam) at an
// in-memory command/event registry instead of the real backend.
registerIpcMocks();
