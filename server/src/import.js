// Loads ../menu.json into PostgreSQL, replacing whatever menu data is there.
//   npm run import            (manual, replaces existing menu data)
// setup.js also calls importMenu() once, on an empty database.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { pool } from "./db.js";

export const DEFAULT_FILE = new URL("../../menu.json", import.meta.url);

export async function importMenu(file = DEFAULT_FILE) {
  const data = JSON.parse((await readFile(file, "utf8")).replace(/^﻿/, ""));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE bundle_items, bundles, items, sections, venues, settings RESTART IDENTITY CASCADE");

    for (const [key, value] of Object.entries(data.settings || {})) {
      await client.query("INSERT INTO settings (key, value) VALUES ($1, $2)", [key, JSON.stringify(value)]);
    }

    let nItems = 0;
    for (const [vi, v] of (data.venues || []).entries()) {
      await client.query("INSERT INTO venues (key, ar, position) VALUES ($1, $2, $3)", [v.key, v.ar || "", vi]);
      for (const [si, s] of (v.sections || []).entries()) {
        const { rows } = await client.query(
          "INSERT INTO sections (venue_key, en, ar, position) VALUES ($1, $2, $3, $4) RETURNING id",
          [v.key, s.en, s.ar || "", si]);
        for (const [ii, it] of (s.items || []).entries()) {
          await client.query(
            `INSERT INTO items (id, section_id, en, ar, d_en, d_ar, price, discount, pic, is_new, sold_out, hidden, position)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [it.id, rows[0].id, it.en, it.ar || "", it.dEn || "", it.dAr || "", it.price, it.discount || 0,
             it.pic || "", !!it.isNew, !!it.soldOut, !!it.hidden, ii]);
          nItems++;
        }
      }
    }

    let nBundles = 0;
    for (const [bi, b] of (data.bundles || []).entries()) {
      await client.query(
        `INSERT INTO bundles (id, en, ar, d_en, d_ar, price, pic, is_new, hidden, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [b.id, b.en, b.ar || "", b.dEn || "", b.dAr || "", b.price, b.pic || "", !!b.isNew, !!b.hidden, bi]);
      for (const [ri, r] of (b.items || []).entries()) {
        const { rowCount } = await client.query(
          `INSERT INTO bundle_items (bundle_id, item_id, qty, position)
           SELECT $1, id, $3, $4 FROM items WHERE id = $2
           ON CONFLICT DO NOTHING`, [b.id, r.id, r.qty || 1, ri]);
        if (!rowCount) console.warn(`  skipped: combo "${b.en}" refers to missing item ${r.id}`);
      }
      nBundles++;
    }

    await client.query("COMMIT");
    return { items: nItems, bundles: nBundles, settings: Object.keys(data.settings || {}).length };
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
