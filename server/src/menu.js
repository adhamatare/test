import { pool } from "./db.js";

// Builds the same JSON shape as menu.json so menu.html can read it unchanged.
export async function loadMenu() {
  const [meta, settings, venues, sections, items, bundles, bundleItems] = await Promise.all([
    pool.query("SELECT version FROM menu_meta WHERE id = 1"),
    pool.query("SELECT key, value FROM settings"),
    pool.query("SELECT key, ar FROM venues ORDER BY position"),
    pool.query("SELECT id, venue_key, en, ar FROM sections ORDER BY position, id"),
    pool.query("SELECT * FROM items ORDER BY position, id"),
    pool.query("SELECT * FROM bundles ORDER BY position, id"),
    pool.query("SELECT bundle_id, item_id, qty FROM bundle_items ORDER BY bundle_id, position"),
  ]);

  const itemsBySection = new Map();
  for (const r of items.rows) {
    const it = { id: r.id, en: r.en, ar: r.ar, dEn: r.d_en, dAr: r.d_ar, price: r.price, discount: r.discount,
                 pic: r.pic, isNew: r.is_new, soldOut: r.sold_out, hidden: r.hidden };
    if (!itemsBySection.has(r.section_id)) itemsBySection.set(r.section_id, []);
    itemsBySection.get(r.section_id).push(it);
  }

  const sectionsByVenue = new Map();
  for (const s of sections.rows) {
    if (!sectionsByVenue.has(s.venue_key)) sectionsByVenue.set(s.venue_key, []);
    sectionsByVenue.get(s.venue_key).push({ en: s.en, ar: s.ar, items: itemsBySection.get(s.id) || [] });
  }

  const refsByBundle = new Map();
  for (const r of bundleItems.rows) {
    if (!refsByBundle.has(r.bundle_id)) refsByBundle.set(r.bundle_id, []);
    refsByBundle.get(r.bundle_id).push({ id: r.item_id, qty: r.qty });
  }

  return {
    version: meta.rows[0]?.version ?? 1,   // the admin sends this back when saving
    settings: Object.fromEntries(settings.rows.map(r => [r.key, r.value])),
    venues: venues.rows.map(v => ({ key: v.key, ar: v.ar, sections: sectionsByVenue.get(v.key) || [] })),
    bundles: bundles.rows.map(b => ({
      id: b.id, en: b.en, ar: b.ar, dEn: b.d_en, dAr: b.d_ar, price: b.price, pic: b.pic,
      isNew: b.is_new, hidden: b.hidden, items: refsByBundle.get(b.id) || [],
    })),
  };
}
