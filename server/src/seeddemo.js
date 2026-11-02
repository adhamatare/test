// Demo orders for trying out the staff screen.
//   npm run seed-demo             add the demo orders
//   npm run seed-demo -- --clear  remove them again
// Demo orders are recognised by the customer name starting with "Demo - ". Refuses to touch a remote database unless --force.
import { pool } from "./db.js";
import { loadMenu } from "./menu.js";

const clear = process.argv.includes("--clear");
const host = new URL(process.env.DATABASE_URL).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(host) && !process.argv.includes("--force")) {
  console.error(`DATABASE_URL points at ${host}, not this computer. Add --force if you really want demo orders there.`);
  process.exit(1);
}

if (clear) {
  const { rowCount } = await pool.query("DELETE FROM orders WHERE customer LIKE 'Demo - %'");
  console.log(`Removed ${rowCount} demo orders.`);
  await pool.end();
  process.exit(0);
}

const round2 = n => Math.round(n * 100) / 100;
const finalPrice = it => Math.round(it.price * (100 - (it.discount || 0))) / 100;

const menu = await loadMenu();
const s = menu.settings;
const items = menu.venues.flatMap(v => v.sections.flatMap(sec => sec.items)).filter(it => !it.hidden && !it.soldOut);
if (items.length < 4) { console.error("Need at least 4 available menu items to make demo orders."); process.exit(1); }
const itemById = new Map(menu.venues.flatMap(v => v.sections.flatMap(sec => sec.items)).map(it => [it.id, it]));
const combo = menu.bundles.find(b => !b.hidden && b.items.length && b.items.every(r => { const it = itemById.get(r.id); return it && !it.hidden && !it.soldOut; }));
const pick = (i, qty = 1, note = "") => { const it = items[i % items.length]; return { ref: it.id, name: it.en, parts: "", unit_price: finalPrice(it), qty, note, saving: 0 }; };
const comboLine = (qty = 1) => {
  const parts = combo.items.map(r => ({ it: itemById.get(r.id), qty: r.qty }));
  const regular = round2(parts.reduce((sum, p) => sum + finalPrice(p.it) * p.qty, 0));
  return { ref: "b:" + combo.id, name: combo.en, parts: parts.map(p => `${p.qty} x ${p.it.en}`).join(", "), unit_price: combo.price, qty, note: "", saving: Math.max(0, round2(regular - combo.price)) };
};

// minutes ago, status, type, customer, extra fields, lines
const demo = [
  [2,  "open",        "takeaway", "Sara",   {},                                                          [pick(0), pick(1, 2)]],
  [6,  "open",        "dinein",   "Omar",   { table_no: "5" },                                           [pick(2, 2), pick(3)]],
  [14, "picked",      "delivery", "Lina",   { phone: "0592151626", address: "12 Olive St, 3rd floor", area: (s.deliveryAreas?.[0]?.en || "") }, [pick(1), pick(2, 3, "no onions")]],
  [22, "in_progress", "dinein",   "Khaled", { table_no: "2", note: "Celebrating a birthday" },         [pick(3, 2), pick(0, 1, "extra sauce")]],
  [30, "in_progress", "takeaway", "Maya",   {},                                                          combo ? [comboLine(1), pick(1)] : [pick(1, 2), pick(2)]],
  [41, "ready",       "takeaway", "Yusuf",  {},                                                          [pick(2), pick(3, 2)]],
  [55, "ready",       "delivery", "Nour",   { phone: "0501234567", address: "8 Palm Ave" },              [pick(0, 2), pick(1)]],
  [80, "cancelled",   "takeaway", "Tariq",  { note: "Customer called to cancel" },                       [pick(3, 3)]],
];

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("DELETE FROM orders WHERE customer LIKE 'Demo - %'");   // run twice, still only one set
  for (const [mins, status, type, name, extra, lines] of demo) {
    const subtotal = round2(lines.reduce((sum, l) => sum + l.unit_price * l.qty, 0));
    const savings = round2(lines.reduce((sum, l) => sum + l.saving * l.qty, 0));
    let fee = 0;
    if (type === "delivery") {
      const area = (s.deliveryAreas || []).find(a => a.en === extra.area);
      fee = Number(s.freeDeliveryOver) > 0 && subtotal >= Number(s.freeDeliveryOver) ? 0 : Number(area ? area.fee : s.deliveryFee) || 0;
    }
    const { rows } = await client.query(
      `INSERT INTO orders (status, type, customer, table_no, phone, address, area, note, subtotal, delivery_fee, savings, total, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now() - make_interval(mins => $13)) RETURNING id`,
      [status, type, `Demo - ${name}`, extra.table_no || "", extra.phone || "", extra.address || "", extra.area || "", extra.note || "",
       subtotal, fee, savings, round2(subtotal + fee), mins]);
    for (const l of lines) {
      await client.query("INSERT INTO order_items (order_id, ref, name, parts, unit_price, qty, note) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [rows[0].id, l.ref, l.name, l.parts, l.unit_price, l.qty, l.note]);
    }
  }
  await client.query("COMMIT");
  console.log(`Added ${demo.length} demo orders (names start with "Demo - "). Remove them with: npm run seed-demo -- --clear`);
} catch (e) {
  await client.query("ROLLBACK");
  console.error("Could not add demo orders:", e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
