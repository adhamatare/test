import express from "express";
import cors from "cors";
import { pool } from "./db.js";
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
app.use(express.json({ limit: "50kb" }));

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

// ---- Orders ----
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

app.get("/api/orders", requireAdmin, async (req, res) => {
  const status = req.query.status;
  if (status && !STATUSES.includes(status)) return res.status(400).json({ error: "Unknown status" });
  res.json(await listOrders(status));
});

app.patch("/api/orders/:number/status", requireAdmin, async (req, res) => {
  const status = req.body?.status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: "Unknown status" });
  const row = await setStatus(Number(req.params.number), status);
  row ? res.json(row) : res.status(404).json({ error: "No such order" });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status === 400 ? 400 : 500).json({ error: err.status === 400 ? "Bad request" : "Server error" });
});

await setup();
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Menu API on http://localhost:${port}`));
