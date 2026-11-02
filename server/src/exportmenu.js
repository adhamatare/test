// Writes the menu in the database to a menu.json file.
//   npm run export-menu                 refreshes ../menu.json (the backup copy the pages fall back to)
//   npm run export-menu -- backup.json  writes to another file
// Run it before a cutover or now and then, then commit menu.json, so the fallback copy and the seed stay current.
import { writeFile } from "node:fs/promises";
import { pool } from "./db.js";
import { loadMenu } from "./menu.js";

const target = process.argv[2] || new URL("../../menu.json", import.meta.url);
const menu = await loadMenu();
delete menu.version;   // an internal counter, not part of the menu
await writeFile(target, JSON.stringify(menu, null, 2) + "\n", "utf8");
console.log(`Wrote ${menu.venues.flatMap(v => v.sections.flatMap(s => s.items)).length} items and ${menu.bundles.length} combos to ${target instanceof URL ? target.pathname.replace(/^\/([A-Za-z]:)/, "$1") : target}`);
await pool.end();
