// Keeps the menu in the database the same as the published menu.json, which admin.html edits.
// MENU_URL is the address of that file (set in render.yaml). Every MENU_SYNC_SECONDS (default 60)
// the server downloads it and, only if it changed, replaces the menu tables with it.
// Without MENU_URL, the server loads ../menu.json once on an empty database (setup.js),
// and `npm run import` updates it by hand.
import { createHash } from "node:crypto";
import { importMenuData } from "./import.js";

const MENU_URL = process.env.MENU_URL || "";
const EVERY_MS = (Number(process.env.MENU_SYNC_SECONDS) || 60) * 1000;
let lastHash = "";

// Returns the import counts when the menu changed, or null when it is the same as last time.
export async function syncMenu() {
  const res = await fetch(`${MENU_URL}${MENU_URL.includes("?") ? "&" : "?"}t=${Date.now()}`,
                          { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${MENU_URL} answered ${res.status}`);
  const text = await res.text();
  const hash = createHash("sha256").update(text).digest("hex");
  if (hash === lastHash) return null;
  const data = JSON.parse(text.replace(/^﻿/, ""));
  const items = (data.venues || []).flatMap(v => (v.sections || []).flatMap(s => s.items || []));
  if (!items.length) throw new Error("the downloaded menu has no items, keeping the current menu");
  const counts = await importMenuData(data);
  lastHash = hash;
  return counts;
}

// Runs one sync now (awaited at start-up, so the menu is fresh before the first order), then one every minute.
// A failed sync is only logged: the server keeps the last good menu and tries again next time.
export async function startMenuSync() {
  if (!MENU_URL) return;
  const run = () => syncMenu()
    .then(r => { if (r) console.log(`Menu updated from ${MENU_URL}: ${r.items} items, ${r.bundles} combos.`); })
    .catch(e => console.warn(`Menu sync skipped: ${e.message}`));
  setInterval(run, EVERY_MS);
  await run();
}
