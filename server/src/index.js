import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { timingSafeEqual } from "node:crypto";
import { loadMenu } from "./menu.js";
import { OrderError, STATUSES, listOrders, priceOrder, saveOrder, setStatus } from "./orders.js";

const app = express();
app.use(cors());          // menu.html is served from another origin (GitHub Pages)
app.use(express.json());

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
// Temporary staff protection: one secret key from .env. A real login replaces this later.
function requireAdmin(req, res, next) {
  const key = process.env.ADMIN_KEY || "";
  const given = Buffer.from(String(req.get("x-admin-key") || ""));
  const want = Buffer.from(key);
  if (!key || given.length !== want.length || !timingSafeEqual(given, want)) return res.status(401).json({ error: "Not allowed" });
  next();
}

// At most 10 order attempts per minute from one address.
const hits = new Map();
function limitOrders(req, res, next) {
  const now = Date.now(), ip = req.ip;
  const recent = (hits.get(ip) || []).filter(t => now - t < 60_000);
  if (recent.length >= 10) return res.status(429).json({ error: "Too many orders, please wait a minute" });
  recent.push(now);
  hits.set(ip, recent);
  next();
}

app.post("/api/orders", limitOrders, async (req, res) => {
  try {
    const order = await saveOrder(await priceOrder(req.body));
    res.status(201).json({ number: order.number, total: order.total, status: order.status });
  } catch (e) {
    if (e instanceof OrderError) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: "Could not save the order" });
  }
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

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Menu API on http://localhost:${port}`));
