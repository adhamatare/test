import { createApp } from "./app.js";
import { pool } from "./db.js";
import { setup } from "./setup.js";

await setup();
const port = Number(process.env.PORT) || 3000;
const server = createApp().listen(port, () => console.log(`Menu API on http://localhost:${port}`));

// The host sends SIGTERM when it deploys a new version: finish the requests in flight, then leave.
function shutDown(signal) {
  console.log(`${signal} received, shutting down.`);
  server.close(async () => { await pool.end().catch(() => {}); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();   // do not hang forever on a stuck connection
}
process.on("SIGTERM", () => shutDown("SIGTERM"));
process.on("SIGINT", () => shutDown("SIGINT"));
