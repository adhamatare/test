import "./env.js";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { freshDb, startServer, closeDb, pool } from "./helpers.js";

let srv;
before(async () => { await freshDb(); srv = await startServer(); });
after(async () => { await srv.close(); await closeDb(); });

const withOrigin = async origin => {
  const res = await fetch(srv.base + "/api/menu", { headers: origin ? { Origin: origin } : {} });
  return res.headers.get("access-control-allow-origin");
};

test("ping answers without needing the database", async () => {
  const r = await srv.api("GET", "/api/ping");
  assert.equal(r.status, 200); assert.deepEqual(r.json, { ok: true });
});

test("health checks the database", async () => {
  const r = await srv.api("GET", "/api/health");
  assert.equal(r.status, 200); assert.deepEqual(r.json, { ok: true });
});

test("unknown API addresses answer in JSON, not an HTML error page", async () => {
  for (const [method, path] of [["GET", "/api/nope"], ["POST", "/api/menu/extra"], ["DELETE", "/api/orders/1"], ["GET", "/api"]]) {
    const r = await srv.api(method, path);
    assert.equal(r.status, 404, `${method} ${path}`);
    assert.equal(r.json?.error, "Not found");
  }
});

test("responses carry basic security headers and do not name the framework", async () => {
  const r = await srv.api("GET", "/api/menu");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.equal(r.headers.get("x-powered-by"), null);
});

test("only the site's own pages may call the API from a browser", async () => {
  assert.equal(await withOrigin("https://adhamatare.github.io"), "https://adhamatare.github.io");
  assert.equal(await withOrigin("http://localhost:8765"), "http://localhost:8765");
  assert.equal(await withOrigin("https://evil.example"), null);
  assert.equal(await withOrigin("https://adhamatare.github.io.evil.example"), null);
  assert.equal(await withOrigin("http://adhamatare.github.io"), null, "plain http is not our site");
});

test("a request with a broken JSON body is a clean 400", async () => {
  const res = await fetch(srv.base + "/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Bad request" });
});

test("the server survives its database connections being cut, and recovers by itself", async () => {
  assert.equal((await srv.api("GET", "/api/health")).status, 200);
  // Kill every connection the app holds, the way a hosted database does when it pauses or restarts.
  const killer = await pool.connect();
  try {
    await killer.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()");
  } finally { killer.release(true); }
  await new Promise(r => setTimeout(r, 300));
  let ok = false;
  for (let i = 0; i < 5 && !ok; i++) ok = (await srv.api("GET", "/api/menu")).status === 200;   // a request or two may hit a dead connection
  assert.ok(ok, "menu must be readable again");
  assert.equal((await srv.api("GET", "/api/health")).status, 200);
});
