// Loads ../menu.json into PostgreSQL, replacing whatever menu data is there.
//   npm run import            (manual, replaces existing menu data)
// setup.js also calls importMenu() once, on an empty database.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { pool } from "./db.js";
import { replaceMenu, validateMenu } from "./menuwrite.js";

export const DEFAULT_FILE = new URL("../../menu.json", import.meta.url);

export async function importMenu(file = DEFAULT_FILE) {
  const data = JSON.parse((await readFile(file, "utf8")).replace(/^﻿/, ""));
  const problem = validateMenu(data);
  if (problem) throw new Error(problem);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await replaceMenu(client, data);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// Only run when started directly (npm run import), not when imported by setup.js.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const r = await importMenu(process.argv[2] || DEFAULT_FILE);
    console.log(`Imported ${r.items} items, ${r.bundles} combos, ${r.settings} settings.`);
  } catch (e) {
    console.error("Import failed, nothing was changed:", e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
