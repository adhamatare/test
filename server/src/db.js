import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (see server/.env)");

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,                            // a small hosted database allows few connections
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 20_000,   // a paused hosted database can take a while to wake up
  keepAlive: true,
});

// Hosted databases drop idle connections (and restart). Without this handler that event would crash the whole server;
// with it the pool just opens a fresh connection on the next request.
pool.on("error", e => console.error("A database connection was lost and will be replaced:", e.message));

// pg returns numeric columns as strings; the pages expect numbers.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number);
