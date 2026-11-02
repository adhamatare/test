// Runs on every start (safe to repeat):
//  1. creates any missing tables
//  2. loads ../menu.json if the menu tables are empty (first deploy only, never overwrites)
//  3. creates the first admin from ADMIN_USERNAME / ADMIN_PASSWORD if there are no users yet
import { readFile } from "node:fs/promises";
import { pool } from "./db.js";
import { hashPassword, MIN_PASSWORD } from "./auth.js";
import { importMenu } from "./import.js";

export async function setup() {
  await pool.query(await readFile(new URL("../schema.sql", import.meta.url), "utf8"));

  const { rows: v } = await pool.query("SELECT count(*)::int AS n FROM venues");
  if (v[0].n === 0) {
    try {
      const r = await importMenu();
      console.log(`First start: loaded ${r.items} items and ${r.bundles} combos from menu.json.`);
    } catch (e) {
      console.warn("Could not load menu.json on first start:", e.message);
    }
  }

  const { rows: u } = await pool.query("SELECT count(*)::int AS n FROM users");
  const { ADMIN_USERNAME: name, ADMIN_PASSWORD: pw } = process.env;
  if (u[0].n === 0 && name && pw) {
    if (pw.length < MIN_PASSWORD) {
      console.warn(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD} characters; no admin was created.`);
    } else {
      await pool.query("INSERT INTO users (username, password_hash) VALUES ($1, $2)", [name.trim(), await hashPassword(pw)]);
      console.log(`First admin "${name.trim()}" created. You can now remove ADMIN_PASSWORD from the environment.`);
    }
  } else if (u[0].n === 0) {
    console.warn("No admin user yet. Set ADMIN_USERNAME and ADMIN_PASSWORD, or run: npm run create-user -- <name>");
  }
}

// `npm run setup` runs it by hand.
if (process.argv[1] && process.argv[1].endsWith("setup.js")) {
  await setup();
  console.log("Setup finished.");
  await pool.end();
}
