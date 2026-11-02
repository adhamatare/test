import { pool } from "./db.js";
import { loadMenu } from "./menu.js";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const TYPES = ["dinein", "takeaway", "delivery"];
export const STATUSES = ["open", "picked", "in_progress", "ready", "cancelled"];

const round2 = n => Math.round(n * 100) / 100;
const finalPrice = it => Math.round(it.price * (100 - (it.discount || 0))) / 100;
const text = (v, max) => String(v ?? "").trim().slice(0, max);

export class OrderError extends Error {}
const fail = msg => { throw new OrderError(msg); };

// Same rules as openStatus() in menu.html, so a customer can't bypass them by calling the API directly.
function isOpen(settings, now = new Date()) {
  if (settings.pauseOrders) return false;
  if (!settings.useHours || !settings.hours) return true;
  let day, mins;
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: settings.timezone || "UTC", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
    }).formatToParts(now).map(x => [x.type, x.value]));
    day = DAYS.indexOf(p.weekday.toLowerCase().slice(0, 3));
    mins = (Number(p.hour) % 24) * 60 + Number(p.minute);
  } catch { return true; }
  const toMin = s => { const [h, m] = String(s).split(":").map(Number); return h * 60 + (m || 0); };
  const rangeOf = d => { const r = settings.hours[DAYS[(d + 7) % 7]]; return r && !r.closed ? [toMin(r.open), toMin(r.close)] : null; };
  const today = rangeOf(day), yesterday = rangeOf(day - 1);
  let open = false;
  if (today) { const [o, c] = today; open = c > o ? mins >= o && mins < c : mins >= o; }
  if (!open && yesterday) { const [o, c] = yesterday; if (c <= o) open = mins < c; }
  return open;
}

// Turns what the customer sent into a priced order. Prices always come from the database, never from the client.
export async function priceOrder(body) {
  const menu = await loadMenu();
  const s = menu.settings;
  if (!isOpen(s)) fail(s.pauseOrders ? "Online ordering is paused right now" : "We're closed right now");

  const type = body?.type;
  if (!TYPES.includes(type)) fail("Choose an order type");
  const customer = text(body.name, 80);
  if (customer.length < 2) fail("Please enter your name");
  const order = { type, customer, table_no: "", phone: "", address: "", area: "", note: text(body.note, 500) };

  if (type === "dinein") {
    order.table_no = text(body.table, 20);
    if (!order.table_no) fail("Please enter your table number");
  }

  const itemById = new Map(menu.venues.flatMap(v => v.sections.flatMap(sec => sec.items)).map(it => [it.id, it]));
  const bundleById = new Map(menu.bundles.map(b => [b.id, b]));

  if (!Array.isArray(body.items) || !body.items.length) fail("Your order is empty");
  if (body.items.length > 50) fail("Too many different items in one order");
  const lines = [];
  const seen = new Set();
  for (const raw of body.items) {
    const ref = String(raw?.id ?? "");
    const qty = Number(raw?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) fail("Invalid quantity");
    if (seen.has(ref)) fail("The same item appears twice");
    seen.add(ref);
    const note = text(raw.note, 200);
    if (ref.startsWith("b:")) {
      const b = bundleById.get(ref.slice(2));
      if (!b || b.hidden) fail("A combo in your order is no longer available");
      const parts = b.items.map(r => ({ it: itemById.get(r.id), qty: r.qty }));
      if (!parts.length || parts.some(p => !p.it || p.it.hidden || p.it.soldOut)) fail(`"${b.en}" is not available right now`);
      const regular = round2(parts.reduce((sum, p) => sum + finalPrice(p.it) * p.qty, 0));
      lines.push({ ref, name: b.en, parts: parts.map(p => `${p.qty} x ${p.it.en}`).join(", "),
                   unit_price: b.price, qty, note, saving: Math.max(0, round2(regular - b.price)) });
    } else {
      const it = itemById.get(ref);
      if (!it || it.hidden) fail("An item in your order is no longer on the menu");
      if (it.soldOut) fail(`${it.en} is sold out`);
      lines.push({ ref, name: it.en, parts: "", unit_price: finalPrice(it), qty, note, saving: 0 });
    }
  }

  const subtotal = round2(lines.reduce((sum, l) => sum + l.unit_price * l.qty, 0));
  const savings = round2(lines.reduce((sum, l) => sum + l.saving * l.qty, 0));

  let delivery_fee = 0;
  if (type === "delivery") {
    order.phone = text(body.phone, 30);
    const digits = order.phone.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) fail("Please enter a valid phone number");
    order.address = text(body.address, 300);
    if (!order.address) fail("Please enter your delivery address");
    if (Number(s.minDeliveryOrder) > 0 && subtotal < Number(s.minDeliveryOrder)) fail(`Minimum order for delivery is ${s.currency}${s.minDeliveryOrder}`);
    const areas = s.deliveryAreas || [];
    let fee;
    if (areas.length) {
      const a = areas[Number(body.area)];
      if (!a) fail("Please select your delivery area");
      order.area = a.en;
      fee = Number(a.fee) || 0;
    } else {
      fee = Number(s.deliveryFee) || 0;
    }
    delivery_fee = Number(s.freeDeliveryOver) > 0 && subtotal >= Number(s.freeDeliveryOver) ? 0 : fee;
  }

  return { ...order, subtotal, delivery_fee, savings, total: round2(subtotal + delivery_fee), lines };
}

export async function saveOrder(priced) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO orders (type, customer, table_no, phone, address, area, note, subtotal, delivery_fee, savings, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, number, status, total, created_at, track_token`,
      [priced.type, priced.customer, priced.table_no, priced.phone, priced.address, priced.area, priced.note,
       priced.subtotal, priced.delivery_fee, priced.savings, priced.total]);
    const order = rows[0];
    for (const l of priced.lines) {
      await client.query(
        "INSERT INTO order_items (order_id, ref, name, parts, unit_price, qty, note) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [order.id, l.ref, l.name, l.parts, l.unit_price, l.qty, l.note]);
    }
    await client.query("COMMIT");
    return order;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// What a customer may see about their own order: nothing but its status and type.
export async function publicStatus(number, token) {
  const { rows } = await pool.query("SELECT number, status, type FROM orders WHERE number = $1 AND track_token = $2", [number, token]);
  return rows[0] || null;
}

export async function listOrders(status) {
  const where = status ? "WHERE o.status = $1" : "";
  const { rows } = await pool.query(
    `SELECT o.id, o.number, o.status, o.type, o.customer, o.table_no, o.phone, o.address, o.area, o.note,
            o.subtotal, o.delivery_fee, o.savings, o.total, o.created_at, COALESCE(json_agg(json_build_object('ref', i.ref, 'name', i.name, 'parts', i.parts,
              'unitPrice', i.unit_price, 'qty', i.qty, 'note', i.note) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
       FROM orders o LEFT JOIN order_items i ON i.order_id = o.id
       ${where} GROUP BY o.id ORDER BY o.created_at DESC LIMIT 200`,
    status ? [status] : []);
  return rows;
}

export async function setStatus(number, status) {
  const { rows } = await pool.query("UPDATE orders SET status = $2 WHERE number = $1 RETURNING number, status", [number, status]);
  return rows[0] || null;
}
