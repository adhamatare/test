import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (see server/.env)");

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// The database can drop an idle connection (restart, failover, Neon going to sleep). Without this listener
// that error would stop the whole server; with it the pool just opens a new connection for the next query.
pool.on("error", e => console.error("Database connection lost:", e.message));

// pg returns numeric columns as strings; the pages expect numbers.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number);
