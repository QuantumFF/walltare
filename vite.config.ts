import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const { TAURI_DEV_HOST: host, WALLTARE_DEV_PORT } = process.env;
// `bun run dev:app` picks a free one so checkouts can run side by side
// (scripts/dev-app.ts); plain `bun tauri dev` keeps the port tauri.conf.json names.
const port = Number(WALLTARE_DEV_PORT ?? 1420);

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: port + 1,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`, and `bun run dev:app`'s
      //    database and thumbnail cache
      ignored: ["**/src-tauri/**", "**/.dev-data/**"],
    },
  },
}));
