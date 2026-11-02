import "./env.js";   // first: selects the test database
import { readFile } from "node:fs/promises";
import pg from "pg";
import { pool } from "../src/db.js";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import { replaceMenu } from "../src/menuwrite.js";
import { fixture } from "./fixture.js";

export { pool, fixture };

async function ensureTestDb() {
  const admin = new pg.Client({ connectionString: process.env.TEST_ADMIN_URL });
  await admin.connect();
  try {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [process.env.TEST_DB_NAME]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${process.env.TEST_DB_NAME}"`);
  } finally { await admin.end(); }
}

// Empty test database with the real schema. `seed: false` leaves the menu tables empty.
export async function freshDb({ seed = true } = {}) {
  await ensureTestDb();
  await pool.query(await readFile(new URL("../schema.sql", import.meta.url), "utf8"));
  await pool.query(`TRUNCATE order_items, orders, sessions, users, images, bundle_items, bundles, items, sections, venues, settings RESTART IDENTITY CASCADE`);
  await pool.query("ALTER SEQUENCE order_number_seq RESTART WITH 100001");
  await pool.query("UPDATE menu_meta SET version = 1 WHERE id = 1");
  if (seed) await setMenu(fixture());
}

// Replaces the menu directly in the database (bypassing the API), e.g. to change a setting for one test.
export async function setMenu(doc) {
  const client = await pool.connect();
  try { await client.query("BEGIN"); await replaceMenu(client, doc); await client.query("COMMIT"); }
  catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

export async function createAdmin(username = "tester", password = "correct-horse-1") {
  await pool.query("INSERT INTO users (username, password_hash) VALUES ($1, $2)", [username, await hashPassword(password)]);
  return { username, password };
}

// Starts the real app on a free port.
export async function startServer() {
  const server = createApp().listen(0);
  await new Promise(r => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let n = 0;
  // Every request gets its own pretend visitor address unless `ip` is given, so rate limits and lockouts never leak between tests.
  async function api(method, path, { body, token, raw, type, ip } = {}) {
    const headers = { "X-Forwarded-For": ip || `10.1.${Math.floor(++n / 250)}.${n % 250}` };
    if (token) headers.Authorization = "Bearer " + token;
    if (raw !== undefined) headers["Content-Type"] = type || "image/jpeg";
    else if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(base + path, { method, headers, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
    const buf = Buffer.from(await res.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString()); } catch {}
    return { status: res.status, json, buf, headers: res.headers };
  }
  const close = () => new Promise(r => server.close(r));
  return { base, api, close };
}

export async function loginAs(api, username = "tester", password = "correct-horse-1") {
  const r = await api("POST", "/api/auth/login", { body: { username, password } });
  if (r.status !== 200) throw new Error("test login failed: " + r.status);
  return r.json.token;
}

export const closeDb = () => pool.end();
