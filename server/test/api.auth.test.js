import "./env.js";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { freshDb, startServer, createAdmin, closeDb, pool } from "./helpers.js";

let srv;
const login = (username, password, ip) => srv.api("POST", "/api/auth/login", { body: { username, password }, ip });

before(async () => { srv = await startServer(); });
beforeEach(async () => { await freshDb(); await createAdmin("Boss", "correct-horse-1"); });
after(async () => { await srv.close(); await closeDb(); });

test("the right password signs in and returns a session", async () => {
  const r = await login("Boss", "correct-horse-1");
  assert.equal(r.status, 200);
  assert.ok(r.json.token.length >= 40);
  assert.equal(r.json.username, "Boss");
  assert.ok(new Date(r.json.expiresAt) > new Date(Date.now() + 11 * 3600e3), "lasts about 12 hours");
});

test("the username is not case sensitive", async () => {
  assert.equal((await login("bOsS", "correct-horse-1")).status, 200);
});

test("the password is case sensitive", async () => {
  assert.equal((await login("Boss", "Correct-Horse-1")).status, 401);
});

test("wrong password, unknown user and empty input all look the same", async () => {
  const a = await login("Boss", "nope"), b = await login("nobody", "correct-horse-1"), c = await login("", ""), d = await srv.api("POST", "/api/auth/login", { body: {} });
  for (const r of [a, b, c, d]) { assert.equal(r.status, 401); assert.equal(r.json.error, "Wrong username or password"); }
});

test("odd login bodies do not crash the server", async () => {
  for (const body of [{ username: { $ne: 1 }, password: [1, 2] }, { username: 5, password: 5 }, { username: "a".repeat(10_000), password: "b".repeat(10_000) }]) {
    const r = await srv.api("POST", "/api/auth/login", { body });
    assert.equal(r.status, 401);
  }
  assert.equal((await login("Boss", "correct-horse-1")).status, 200, "still healthy");
});

test("the database stores only a hash of the session token", async () => {
  const { json } = await login("Boss", "correct-horse-1");
  const { rows } = await pool.query("SELECT token_hash FROM sessions");
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, json.token);
  assert.equal(rows[0].token_hash, createHash("sha256").update(json.token).digest("hex"));
});

test("the session token opens staff pages", async () => {
  const { json } = await login("Boss", "correct-horse-1");
  const me = await srv.api("GET", "/api/auth/me", { token: json.token });
  assert.equal(me.status, 200); assert.equal(me.json.username, "Boss");
  assert.equal((await srv.api("GET", "/api/orders", { token: json.token })).status, 200);
});

test("no token, a made-up token, or the wrong scheme are all refused", async () => {
  assert.equal((await srv.api("GET", "/api/auth/me")).status, 401);
  assert.equal((await srv.api("GET", "/api/auth/me", { token: "made-up" })).status, 401);
  const res = await fetch(srv.base + "/api/auth/me", { headers: { Authorization: "Basic Qm9zczpjb3JyZWN0LWhvcnNlLTE=" } });
  assert.equal(res.status, 401);
});

test("an expired session is refused", async () => {
  const { json } = await login("Boss", "correct-horse-1");
  await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
  assert.equal((await srv.api("GET", "/api/auth/me", { token: json.token })).status, 401);
});

test("logging out ends that session only", async () => {
  const a = (await login("Boss", "correct-horse-1")).json.token;
  const b = (await login("Boss", "correct-horse-1")).json.token;
  assert.equal((await srv.api("POST", "/api/auth/logout", { token: a })).status, 200);
  assert.equal((await srv.api("GET", "/api/auth/me", { token: a })).status, 401);
  assert.equal((await srv.api("GET", "/api/auth/me", { token: b })).status, 200);
});

test("logging out with no or a bad token is harmless", async () => {
  assert.equal((await srv.api("POST", "/api/auth/logout")).status, 200);
  assert.equal((await srv.api("POST", "/api/auth/logout", { token: "junk" })).status, 200);
});

test("five wrong passwords lock that address, even for the right password", async () => {
  const ip = "203.0.113.7";
  for (let i = 0; i < 5; i++) assert.equal((await login("Boss", "wrong" + i, ip)).status, 401);
  const locked = await login("Boss", "correct-horse-1", ip);
  assert.equal(locked.status, 429);
  assert.match(locked.json.error, /Too many wrong passwords/);
});

test("the lockout is per address: others can still sign in", async () => {
  for (let i = 0; i < 5; i++) await login("Boss", "wrong", "203.0.113.8");
  assert.equal((await login("Boss", "correct-horse-1", "203.0.113.9")).status, 200);
});

test("a successful login clears earlier failures", async () => {
  const ip = "203.0.113.10";
  for (let i = 0; i < 4; i++) await login("Boss", "wrong", ip);
  assert.equal((await login("Boss", "correct-horse-1", ip)).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await login("Boss", "wrong", ip)).status, 401);   // counter started again from zero
});

test("every staff endpoint refuses visitors", async () => {
  for (const [method, path] of [["GET", "/api/orders"], ["PATCH", "/api/orders/100001/status"], ["PUT", "/api/menu"], ["POST", "/api/images"], ["GET", "/api/auth/me"]]) {
    const r = await srv.api(method, path, method === "PATCH" || method === "PUT" ? { body: { status: "ready", baseVersion: 1 } } : undefined);
    assert.equal(r.status, 401, `${method} ${path}`);
  }
});

test("a login attempt cannot fall back to a blank password", async () => {
  await pool.query("UPDATE users SET password_hash = ''");   // a damaged row must fail closed
  assert.equal((await login("Boss", "")).status, 401);
  assert.equal((await login("Boss", "anything")).status, 401);
});
