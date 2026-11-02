import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (see server/.env)");

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// pg returns numeric columns as strings; the pages expect numbers.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number);
