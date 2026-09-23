// `bun run dev:app`: `bun tauri dev` that can run in several checkouts at once.
//
// Plain `bun tauri dev` pins Vite to port 1420 and opens the one database every
// build shares, so a second checkout either cannot start or migrates the
// database out from under the first. This picks the first free port from 1420
// and points the app at a data dir inside the checkout, seeded from the real
// database the first time so a new worktree opens on your library.
// See docs/adr/0048-a-dev-run-owns-its-checkout.md.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const dataDir = path.join(root, ".dev-data");

// Free on both loopbacks, because Vite's `localhost` resolves to ::1 here and
// a port another Vite holds on ::1 still binds fine on 127.0.0.1.
function isFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host, exclusive: true }, () =>
      server.close(() => resolve(true)),
    );
  });
}

async function freePort(from: number): Promise<number> {
  for (let port = from; port < from + 100; port++) {
    if ((await isFree(port, "127.0.0.1")) && (await isFree(port, "::1"))) {
      return port;
    }
  }
  throw new Error(`no free port in ${from}..${from + 99}`);
}

// VACUUM INTO rather than a file copy: the installed app may have the database
// open, and a copy of walltare.db without its WAL is missing the latest writes.
function seed() {
  const target = path.join(dataDir, "walltare.db");
  if (existsSync(target)) return;
  mkdirSync(dataDir, { recursive: true });
  const dataHome =
    process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share");
  const source = path.join(dataHome, "com.quantumff.walltare", "walltare.db");
  if (!existsSync(source)) return;
  const db = new Database(source, { readonly: true });
  db.run("VACUUM INTO ?", [target]);
  db.close();
  console.log(`dev:app: seeded ${target} from ${source}`);
}

seed();
const port = await freePort(1420);
console.log(`dev:app: port ${port}, data in ${dataDir}`);

const tauri = Bun.spawn(
  [
    "bunx",
    "tauri",
    "dev",
    "--config",
    JSON.stringify({ build: { devUrl: `http://localhost:${port}` } }),
    ...process.argv.slice(2),
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      WALLTARE_DEV_PORT: String(port),
      WALLTARE_DATA_DIR: dataDir,
    },
    stdio: ["inherit", "inherit", "inherit"],
  },
);
process.exit(await tauri.exited);
