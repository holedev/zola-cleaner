import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { openDb } from "@zalo-cleaner/core";
import { createApp } from "./app.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dataDir = process.env.ZC_DATA_DIR ?? path.join(repoRoot, "data");
const port = Number(process.env.PORT ?? 5174);

const db = openDb(path.join(dataDir, "zalo-cleaner.db"));
const app = createApp(db);

// Chỉ lắng nghe loopback, không mở ra mạng LAN.
serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, (info) => {
  console.log(`API: http://127.0.0.1:${info.port}  ·  CSDL: ${path.join(dataDir, "zalo-cleaner.db")}`);
});
