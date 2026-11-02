import { randomBytes } from "node:crypto";
import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { MenuError, saveMenu } from "./menuwrite.js";
import { lockedFor, login, logout, requireAdmin } from "./auth.js";
import { loadMenu } from "./menu.js";
import { setup } from "./setup.js";
import { OrderError, STATUSES, listOrders, priceOrder, publicStatus, saveOrder, setStatus } from "./orders.js";

const app = express();
// Behind the host's proxy, req.ip must be the visitor's address (used by the order limit and the login lockout).
app.set("trust proxy", 1);

// Only our own pages may call the API from a browser. ALLOWED_ORIGINS is a comma-separated list.
const allowed = (process.env.ALLOWED_ORIGINS || "https://adhamatare.github.io,http://localhost:8765,http://localhost:3000")
  .split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: (origin, done) => done(null, !origin || allowed.includes(origin)) }));
// Small bodies everywhere, except the menu save, which carries the whole menu.
const smallJson = express.json({ limit: "50kb" }), menuJson = express.json({ limit: "1mb" });
app.use((req, res, next) => (req.method === "PUT" && req.path === "/api/menu" ? menuJson : smallJson)(req, res, next));

// Express 4 does not catch errors thrown inside async handlers; this passes them to the error handler.
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get("/api/health", async (_req, res) => {
  try { await pool.query("SELECT 1"); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

app.get("/api/menu", async (_req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(await loadMenu());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load the menu" });
  }
});

// The admin page saves the whole menu here (staff only). It must send the version it loaded.
app.put("/api/menu", requireAdmin, wrap(async (req, res) => {
  const { baseVersion, ...menu } = req.body || {};
  if (!Number.isInteger(baseVersion)) return res.status(400).json({ error: "Missing menu version. Reload the page." });
  try {
    res.json({ version: await saveMenu(menu, baseVersion) });
  } catch (e) {
    if (e instanceof MenuError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));

// ---- Photos (stored in the database) ----
app.post("/api/images", requireAdmin, express.raw({ type: "image/jpeg", limit: "3mb" }), wrap(async (req, res) => {
  const b = req.body;
  if (!Buffer.isBuffer(b) || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return res.status(400).json({ error: "Please send a JPEG photo (up to 3 MB)." });
  const id = randomBytes(8).toString("hex") + ".jpg";
  await pool.query("INSERT INTO images (id, content_type, data) VALUES ($1, 'image/jpeg', $2)", [id, b]);
  res.status(201).json({ path: `/api/images/${id}` });
}));

app.get("/api/images/:id", wrap(async (req, res) => {
  if (!/^[a-f0-9]{16}\.jpg$/.test(req.params.id)) return res.status(404).end();
  const { rows } = await pool.query("SELECT content_type, data FROM images WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).end();
  res.set({ "Content-Type": rows[0].content_type, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
  res.send(rows[0].data);   // each upload gets a new id, so the cached copy never goes stale
}));

// ---- Staff login ----
app.post("/api/auth/login", async (req, res, next) => {
  try {
    const wait = lockedFor(req.ip);
    if (wait) return res.status(429).json({ error: `Too many wrong passwords. Try again in ${Math.ceil(wait / 60000)} minutes.` });
    const session = await login(req.ip, req.body?.username, req.body?.password);
    if (!session) return res.status(401).json({ error: "Wrong username or password" });
    res.json(session);
  } catch (e) { next(e); }
});

app.get("/api/auth/me", requireAdmin, (req, res) => res.json({ username: req.user.username }));

app.post("/api/auth/logout", async (req, res, next) => {
  try { await logout(req); res.json({ ok: true }); } catch (e) { next(e); }
});

// At most `max` requests per minute from one address.
function limiter(max, message) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now(), ip = req.ip;
    const recent = (hits.get(ip) || []).filter(t => now - t < 60_000);
    if (recent.length >= max) return res.status(429).json({ error: message });
    recent.push(now);
    hits.set(ip, recent);
    next();
  };
}
const limitOrders = limiter(10, "Too many orders, please wait a minute");
const limitStatus = limiter(60, "Too many requests, please wait a moment");

app.post("/api/orders", limitOrders, async (req, res) => {
  try {
    const order = await saveOrder(await priceOrder(req.body));
    res.status(201).json({ number: order.number, total: order.total, status: order.status, token: order.track_token });
  } catch (e) {
    if (e instanceof OrderError) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: "Could not save the order" });
  }
});

// A customer checks their own order with the number and the secret they were given when ordering.
app.get("/api/orders/:number/status", limitStatus, async (req, res, next) => {
  try {
    const row = await publicStatus(Number(req.params.number), String(req.query.t || ""));
    row ? res.set("Cache-Control", "no-store").json(row) : res.status(404).json({ error: "No such order" });
  } catch (e) { next(e); }
});

app.get("/api/orders", requireAdmin, wrap(async (req, res) => {
  const status = req.query.status;
  if (status && !STATUSES.includes(status)) return res.status(400).json({ error: "Unknown status" });
  res.json(await listOrders(status));
}));

app.patch("/api/orders/:number/status", requireAdmin, wrap(async (req, res) => {
  const status = req.body?.status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: "Unknown status" });
  const row = await setStatus(Number(req.params.number), status);
  row ? res.json(row) : res.status(404).json({ error: "No such order" });
}));

app.use((err, _req, res, _next) => {
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 413 ? "That is too large." : status === 500 ? "Server error" : "Bad request" });
});

await setup();
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Menu API on http://localhost:${port}`));
