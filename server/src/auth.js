import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { pool } from "./db.js";

const scryptAsync = promisify(scrypt);
const SESSION_HOURS = 12;
export const MIN_PASSWORD = 8;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function checkPassword(password, stored) {
  const parts = String(stored).split("$");
  // Anything that is not exactly salt + hash fails closed. (An empty or damaged hash used to decode to nothing and match anything.)
  if (parts.length !== 3 || parts[0] !== "scrypt" || !/^[0-9a-f]{32}$/.test(parts[1]) || !/^[0-9a-f]{128}$/.test(parts[2])) return false;
  const [, saltHex, hashHex] = parts;
  const want = Buffer.from(hashHex, "hex");
  const got = await scryptAsync(password, Buffer.from(saltHex, "hex"), want.length);
  return timingSafeEqual(got, want);
}

// Compared against when the username does not exist, so the response time does not reveal which usernames are real.
const DUMMY = await hashPassword("not-a-real-password");

const sha = token => createHash("sha256").update(token).digest("hex");

// 5 wrong passwords from one address locks it out for 15 minutes.
const fails = new Map();
const MAX_FAILS = 5, LOCK_MS = 15 * 60_000;
export function lockedFor(ip) {
  const f = fails.get(ip);
  if (!f || f.count < MAX_FAILS) return 0;
  const left = f.at + LOCK_MS - Date.now();
  if (left <= 0) { fails.delete(ip); return 0; }
  return left;
}
const noteFail = ip => { const f = fails.get(ip); fails.set(ip, { count: (f?.count || 0) + 1, at: Date.now() }); };

export async function login(ip, username, password) {
  const { rows } = await pool.query("SELECT id, username, password_hash FROM users WHERE lower(username) = lower($1)", [String(username || "").slice(0, 100)]);
  const user = rows[0];
  const ok = await checkPassword(String(password || "").slice(0, 200), user ? user.password_hash : DUMMY);
  if (!user || !ok) { noteFail(ip); return null; }
  fails.delete(ip);
  const token = randomBytes(32).toString("base64url");
  const { rows: s } = await pool.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3)) RETURNING expires_at",
    [sha(token), user.id, SESSION_HOURS]);
  pool.query("DELETE FROM sessions WHERE expires_at < now()").catch(() => {});   // tidy up old sessions
  return { token, expiresAt: s[0].expires_at, username: user.username };
}

export async function userFor(req) {
  const m = /^Bearer (.+)$/.exec(req.get("authorization") || "");
  if (!m) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha(m[1])]);
  return rows[0] || null;
}

export async function logout(req) {
  const m = /^Bearer (.+)$/.exec(req.get("authorization") || "");
  if (m) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha(m[1])]);
}

export async function requireAdmin(req, res, next) {
  try {
    const user = await userFor(req);
    if (!user) return res.status(401).json({ error: "Please sign in" });
    req.user = user;
    next();
  } catch (e) { next(e); }
}
