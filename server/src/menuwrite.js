import { pool } from "./db.js";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const isStr = (v, max) => typeof v === "string" && v.length <= max;
const isNum = v => typeof v === "number" && Number.isFinite(v);

export class MenuError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

// Returns a readable problem, or "" when the document is fine.
export function validateMenu(d) {
  if (!d || typeof d !== "object") return "The menu is missing.";
  const s = d.settings;
  if (!s || typeof s !== "object" || Array.isArray(s)) return "The settings are missing.";
  if (JSON.stringify(s).length > 50_000) return "The settings are too large.";
  for (const k of ["deliveryFee", "minDeliveryOrder", "freeDeliveryOver"]) if (!(isNum(Number(s[k])) && Number(s[k]) >= 0)) return "Delivery fee, minimum order and free-delivery amount can't be negative.";
  if (!/^\d{8,15}$/.test(String(s.whatsapp ?? "").replace(/\D/g, ""))) return "The orders WhatsApp number must be 8 to 15 digits with the country code.";
  if (s.useHours) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: s.timezone }); } catch { return `"${s.timezone}" is not a valid time zone.`; }
    for (const day of DAYS) {
      const r = s.hours?.[day];
      if (!r) return `Opening hours for ${day} are missing.`;
      if (!r.closed && !(/^\d{2}:\d{2}$/.test(r.open) && /^\d{2}:\d{2}$/.test(r.close))) return `Set open and close times for ${day}, or mark it closed.`;
    }
  }
  if (!Array.isArray(s.deliveryAreas ?? [])) return "Delivery areas are invalid.";
  for (const a of s.deliveryAreas || []) {
    if (!isStr(a?.en, 100) || !a.en.trim()) return "Every delivery area needs an English name.";
    if (!(isNum(Number(a.fee)) && Number(a.fee) >= 0)) return `Delivery area "${a.en}" has an invalid fee.`;
  }

  if (!Array.isArray(d.venues) || !d.venues.length) return "There must be at least one menu (for example Restaurant).";
  const venueKeys = new Set(), itemIds = new Set();
  for (const v of d.venues) {
    if (!isStr(v?.key, 60) || !v.key.trim()) return "Every menu needs a name.";
    if (venueKeys.has(v.key)) return `Two menus are both called "${v.key}".`;
    venueKeys.add(v.key);
    if (!Array.isArray(v.sections)) return `"${v.key}" has invalid sections.`;
    for (const sec of v.sections) {
      if (!isStr(sec?.en, 100) || !sec.en.trim()) return `A section in "${v.key}" has no English title.`;
      if (!Array.isArray(sec.items)) return `"${sec.en}" has invalid items.`;
      for (const it of sec.items) {
        if (!isStr(it?.id, 60) || !/^[\w-]+$/.test(it.id)) return `An item in "${sec.en}" has an invalid id.`;
        if (itemIds.has(it.id)) return `Two items share the id "${it.id}".`;
        itemIds.add(it.id);
        if (!isStr(it.en, 150) || !it.en.trim()) return `An item in "${sec.en}" has no English title.`;
        for (const k of ["ar", "dEn", "dAr", "pic"]) if (it[k] != null && !isStr(it[k], 500)) return `"${it.en}" has a ${k} text that is too long.`;
        if (!(isNum(it.price) && it.price >= 0 && it.price < 1e6)) return `"${it.en}" has an invalid price.`;
        if (!(Number.isInteger(it.discount ?? 0) && (it.discount ?? 0) >= 0 && (it.discount ?? 0) <= 100)) return `"${it.en}" needs a discount between 0 and 100.`;
      }
    }
  }

  const bundleIds = new Set();
  for (const b of d.bundles || []) {
    if (!isStr(b?.id, 60) || !/^[\w-]+$/.test(b.id)) return "A combo offer has an invalid id.";
    if (bundleIds.has(b.id)) return `Two combo offers share the id "${b.id}".`;
    bundleIds.add(b.id);
    if (!isStr(b.en, 150) || !b.en.trim()) return "Every combo offer needs an English title.";
    if (!(isNum(b.price) && b.price >= 0 && b.price < 1e6)) return `The combo "${b.en}" has an invalid price.`;
    if (!Array.isArray(b.items) || !b.items.length) return `The combo "${b.en}" has no items.`;
    for (const r of b.items) {
      if (!itemIds.has(r?.id)) return `The combo "${b.en}" includes an item that no longer exists.`;
      if (!(Number.isInteger(r.qty) && r.qty >= 1 && r.qty <= 50)) return `Every item in "${b.en}" needs a quantity of 1 or more.`;
    }
  }
  return "";
}

// Replaces all menu data with `d`. Call inside a transaction on `client`.
export async function replaceMenu(client, d) {
  // DELETE (not TRUNCATE) so readers and new orders are not blocked while the admin saves.
  await client.query("DELETE FROM bundles");
  await client.query("DELETE FROM venues");   // sections and items go with it
  await client.query("DELETE FROM settings");

  for (const [key, value] of Object.entries(d.settings || {})) {
    await client.query("INSERT INTO settings (key, value) VALUES ($1, $2)", [key, JSON.stringify(value)]);
  }

  let nItems = 0;
  for (const [vi, v] of (d.venues || []).entries()) {
    await client.query("INSERT INTO venues (key, ar, position) VALUES ($1, $2, $3)", [v.key, v.ar || "", vi]);
    for (const [si, s] of (v.sections || []).entries()) {
      const { rows } = await client.query(
        "INSERT INTO sections (venue_key, en, ar, position) VALUES ($1, $2, $3, $4) RETURNING id", [v.key, s.en, s.ar || "", si]);
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
  for (const [bi, b] of (d.bundles || []).entries()) {
    await client.query(
      `INSERT INTO bundles (id, en, ar, d_en, d_ar, price, pic, is_new, hidden, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [b.id, b.en, b.ar || "", b.dEn || "", b.dAr || "", b.price, b.pic || "", !!b.isNew, !!b.hidden, bi]);
    const qtyById = new Map();   // the same item listed twice in a combo counts once, with the quantities added
    for (const r of b.items || []) qtyById.set(r.id, (qtyById.get(r.id) || 0) + (r.qty || 1));
    let ri = 0;
    for (const [itemId, qty] of qtyById) {
      const { rowCount } = await client.query(
        "INSERT INTO bundle_items (bundle_id, item_id, qty, position) SELECT $1, id, $3, $4 FROM items WHERE id = $2", [b.id, itemId, qty, ri++]);
      if (!rowCount) console.warn(`  skipped: combo "${b.en}" refers to missing item ${itemId}`);
    }
    nBundles++;
  }

  await client.query("UPDATE menu_meta SET version = version + 1, updated_at = now() WHERE id = 1");
  return { items: nItems, bundles: nBundles, settings: Object.keys(d.settings || {}).length };
}

// Saves what the admin edited, unless somebody else saved first.
export async function saveMenu(d, baseVersion) {
  const problem = validateMenu(d);
  if (problem) throw new MenuError(problem);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT version FROM menu_meta WHERE id = 1 FOR UPDATE");
    if (rows[0].version !== baseVersion) throw new MenuError("The menu was changed somewhere else. Reload this page and try again.", 409);
    await replaceMenu(client, d);
    const { rows: v } = await client.query("SELECT version FROM menu_meta WHERE id = 1");
    await client.query("COMMIT");
    return v[0].version;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
