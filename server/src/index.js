import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { loadMenu } from "./menu.js";

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

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Menu API on http://localhost:${port}`));
