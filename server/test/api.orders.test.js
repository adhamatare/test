import "./env.js";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { freshDb, setMenu, startServer, createAdmin, loginAs, closeDb, fixture, pool } from "./helpers.js";

let srv, token;
const place = (body, ip) => srv.api("POST", "/api/orders", { body, ip });
const takeaway = (items, extra = {}) => ({ type: "takeaway", name: "Sara", items, ...extra });
const lines = (...pairs) => pairs.map(([id, qty = 1, note]) => ({ id, qty, ...(note ? { note } : {}) }));
const staffList = async q => (await srv.api("GET", "/api/orders" + (q || ""), { token })).json;

before(async () => { srv = await startServer(); });
beforeEach(async () => { await freshDb(); await createAdmin(); token = await loginAs(srv.api); });
after(async () => { await srv.close(); await closeDb(); });

// ---------- pricing: the server decides ----------
test("an order is saved with a number, a status of open and a secret", async () => {
  const r = await place(takeaway(lines(["burger", 2])));
  assert.equal(r.status, 201);
  assert.equal(r.json.number, 100001);
  assert.equal(r.json.status, "open");
  assert.equal(r.json.total, 20);
  assert.match(r.json.token, /^[0-9a-f]{32}$/);
});

test("order numbers count up", async () => {
  assert.equal((await place(takeaway(lines(["burger"])))).json.number, 100001);
  assert.equal((await place(takeaway(lines(["burger"])))).json.number, 100002);
});

test("prices sent by the customer are ignored", async () => {
  const r = await place(takeaway([{ id: "burger", qty: 1, price: 0.01, unitPrice: 0.01 }], { total: 0.01, subtotal: 0.01 }));
  assert.equal(r.json.total, 10);
});

test("item discounts are applied (pizza 20 at 50% off is 10)", async () => {
  assert.equal((await place(takeaway(lines(["pizza", 3])))).json.total, 30);
});

test("items from both menus can share one order", async () => {
  assert.equal((await place(takeaway(lines(["burger"], ["latte", 2], ["mocha"])))).json.total, 24);
});

test("a combo is charged at its own price and remembers what it contains and saves", async () => {
  const r = await place(takeaway(lines(["b:combo1", 2])));
  assert.equal(r.status, 201);
  assert.equal(r.json.total, 24);
  const [o] = await staffList();
  assert.equal(o.savings, 4);                       // 14 regular - 12 = 2, twice
  assert.equal(o.items[0].name, "Burger and Latte");
  assert.equal(o.items[0].parts, "1 x Burger, 1 x Latte");
});

test("an order keeps the prices it was placed with, even after the menu changes", async () => {
  await place(takeaway(lines(["burger", 2])));
  const m = (await srv.api("GET", "/api/menu")).json; const v = m.version; delete m.version;
  m.venues[0].sections[0].items.find(i => i.id === "burger").price = 99;
  assert.equal((await srv.api("PUT", "/api/menu", { token, body: { ...m, baseVersion: v } })).status, 200);
  const [o] = await staffList();
  assert.equal(o.total, 20);
  assert.equal(o.items[0].unitPrice, 10);
});

// ---------- what can be ordered ----------
test("sold out, hidden and unknown items are refused", async () => {
  const soldOut = await place(takeaway(lines(["soup"])));
  assert.equal(soldOut.status, 400); assert.match(soldOut.json.error, /sold out/);
  assert.equal((await place(takeaway(lines(["secret"])))).status, 400);
  assert.equal((await place(takeaway(lines(["no-such-item"])))).status, 400);
  assert.equal((await place(takeaway(lines(["b:no-such-combo"])))).status, 400);
});

test("a combo containing a sold-out item is refused", async () => {
  const r = await place(takeaway(lines(["b:combo2"])));
  assert.equal(r.status, 400); assert.match(r.json.error, /not available/);
});

test("a hidden combo is refused", async () => {
  const f = fixture(); f.bundles[0].hidden = true; await setMenu(f);
  assert.equal((await place(takeaway(lines(["b:combo1"])))).status, 400);
});

test("marking an item sold out in the admin stops new orders for it at once", async () => {
  assert.equal((await place(takeaway(lines(["burger"])))).status, 201);
  const m = (await srv.api("GET", "/api/menu")).json; const v = m.version; delete m.version;
  m.venues[0].sections[0].items.find(i => i.id === "burger").soldOut = true;
  await srv.api("PUT", "/api/menu", { token, body: { ...m, baseVersion: v } });
  assert.equal((await place(takeaway(lines(["burger"])))).status, 400);
});

test("bad quantities are refused", async () => {
  for (const qty of [0, -1, 1.5, 51, "2", null, "abc"]) {
    assert.equal((await place(takeaway([{ id: "burger", qty }]))).status, 400, `qty ${JSON.stringify(qty)}`);
  }
});

test("empty orders, repeated lines and huge orders are refused", async () => {
  assert.equal((await place(takeaway([]))).status, 400);
  assert.equal((await place({ type: "takeaway", name: "Sara" })).status, 400);
  assert.equal((await place(takeaway(lines(["burger"], ["burger"])))).status, 400);
  assert.equal((await place(takeaway(Array.from({ length: 51 }, (_, i) => ({ id: "x" + i, qty: 1 }))))).status, 400);
});

test("a name and a valid order type are required", async () => {
  assert.equal((await place({ type: "takeaway", name: "S", items: lines(["burger"]) })).status, 400);
  assert.equal((await place({ type: "takeaway", name: "   ", items: lines(["burger"]) })).status, 400);
  assert.equal((await place({ type: "teleport", name: "Sara", items: lines(["burger"]) })).status, 400);
  assert.equal((await place({ name: "Sara", items: lines(["burger"]) })).status, 400);
});

test("garbage bodies are refused, not crashes", async () => {
  for (const body of [null, [], "text", 5, { items: "burger", type: "takeaway", name: "Sara" }, { items: [null], type: "takeaway", name: "Sara" }, { items: [{}], type: "takeaway", name: "Sara" }]) {
    const r = await place(body);
    assert.ok(r.status >= 400 && r.status < 500, JSON.stringify(body) + " -> " + r.status);
  }
});

test("dine-in needs a table number", async () => {
  assert.equal((await place({ type: "dinein", name: "Sara", items: lines(["burger"]) })).status, 400);
  assert.equal((await place({ type: "dinein", name: "Sara", table: "7", items: lines(["burger"]) })).status, 201);
  assert.equal((await staffList())[0].table_no, "7");
});

test("long notes and names are cut, not rejected, and cannot break the page", async () => {
  const r = await place(takeaway(lines(["burger", 1, "<img src=x onerror=alert(1)>" + "n".repeat(500)]), { name: "<b>Sara</b>" + "x".repeat(200), note: "y".repeat(2000) }));
  assert.equal(r.status, 201);
  const [o] = await staffList();
  assert.ok(o.customer.length <= 80); assert.ok(o.note.length <= 500); assert.ok(o.items[0].note.length <= 200);
});

// ---------- delivery rules (fixture: minimum 20, free over 50, areas North $5 and South $2) ----------
const delivery = (items, extra = {}) => ({ type: "delivery", name: "Sara", phone: "0501234567", address: "12 Palm St", area: "0", items, ...extra });

test("delivery adds the fee of the chosen area", async () => {
  assert.equal((await place(delivery(lines(["burger", 2])))).json.total, 25);                        // North, 20 + 5
  assert.equal((await place(delivery(lines(["burger", 2]), { area: "1" }))).json.total, 22);          // South, 20 + 2
});

test("delivery is free from the free-delivery amount", async () => {
  assert.equal((await place(delivery(lines(["burger", 5])))).json.total, 50);
});

test("delivery below the minimum order is refused", async () => {
  const r = await place(delivery(lines(["burger"])));
  assert.equal(r.status, 400); assert.match(r.json.error, /Minimum order/);
});

test("delivery needs a valid phone, an address and an area", async () => {
  const items = lines(["burger", 2]);
  assert.equal((await place(delivery(items, { phone: "123" }))).status, 400);
  assert.equal((await place(delivery(items, { phone: "" }))).status, 400);
  assert.equal((await place(delivery(items, { address: "  " }))).status, 400);
  assert.equal((await place(delivery(items, { area: "9" }))).status, 400);
  assert.equal((await place(delivery(items, { area: "-1" }))).status, 400);
  assert.equal((await place(delivery(items, { area: "abc" }))).status, 400);
  const noArea = delivery(items); delete noArea.area;
  assert.equal((await place(noArea)).status, 400);
});

test("an empty area is not quietly turned into the first area", async () => {
  assert.equal((await place(delivery(lines(["burger", 2]), { area: "" }))).status, 400);
  assert.equal((await place(delivery(lines(["burger", 2]), { area: null }))).status, 400);
});

test("with no delivery areas defined, the flat fee applies", async () => {
  const f = fixture(); f.settings.deliveryAreas = []; await setMenu(f);
  const r = await place(delivery(lines(["burger", 2]), { area: "" }));
  assert.equal(r.status, 201); assert.equal(r.json.total, 23);
});

test("takeaway never pays a delivery fee", async () => {
  assert.equal((await place(takeaway(lines(["burger"]), { area: "0" }))).json.total, 10);
});

// ---------- opening hours ----------
test("closed all day: orders are refused", async () => {
  const f = fixture(); f.settings.useHours = true;
  for (const d of Object.keys(f.settings.hours)) f.settings.hours[d] = { closed: true, open: "09:00", close: "17:00" };
  await setMenu(f);
  const r = await place(takeaway(lines(["burger"])));
  assert.equal(r.status, 400); assert.match(r.json.error, /closed/i);
});

test("paused ordering refuses orders", async () => {
  const f = fixture(); f.settings.pauseOrders = true; await setMenu(f);
  const r = await place(takeaway(lines(["burger"])));
  assert.equal(r.status, 400); assert.match(r.json.error, /paused/i);
});

test("a refused order leaves nothing behind", async () => {
  await place(takeaway(lines(["soup"])));
  await place(takeaway(lines(["burger"], ["soup"])));
  const { rows } = await pool.query("SELECT (SELECT count(*) FROM orders)::int AS o, (SELECT count(*) FROM order_items)::int AS i");
  assert.deepEqual(rows[0], { o: 0, i: 0 });
});

// ---------- rate limit ----------
test("an address can place at most 10 orders a minute", async () => {
  const ip = "198.51.100.5";
  for (let i = 0; i < 10; i++) assert.equal((await place(takeaway(lines(["burger"])), ip)).status, 201);
  assert.equal((await place(takeaway(lines(["burger"])), ip)).status, 429);
  assert.equal((await place(takeaway(lines(["burger"])), "198.51.100.6")).status, 201, "another address is unaffected");
});

// ---------- the customer's status lookup ----------
test("a customer sees only the status and type of their own order", async () => {
  const { json } = await place(takeaway(lines(["burger"])));
  const r = await srv.api("GET", `/api/orders/${json.number}/status?t=${json.token}`);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ["number", "status", "type"]);
  assert.equal(r.json.status, "open");
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("the lookup needs the right secret", async () => {
  const { json } = await place(takeaway(lines(["burger"])));
  for (const t of ["", "wrong", "0".repeat(32), json.token.toUpperCase(), json.token.slice(0, 31)]) {
    assert.equal((await srv.api("GET", `/api/orders/${json.number}/status?t=${t}`)).status, 404, `t=${t}`);
  }
  assert.equal((await srv.api("GET", `/api/orders/${json.number}/status`)).status, 404);
});

test("one customer's secret does not open another customer's order", async () => {
  const a = (await place(takeaway(lines(["burger"])))).json, b = (await place(takeaway(lines(["burger"])))).json;
  assert.equal((await srv.api("GET", `/api/orders/${b.number}/status?t=${a.token}`)).status, 404);
});

test("odd order numbers in the lookup are 404, never a server error", async () => {
  for (const n of ["abc", "-1", "1.5", "99999999999999", "", "NaN", "1e3"]) {
    const r = await srv.api("GET", `/api/orders/${n}/status?t=x`);
    assert.ok(r.status === 404, `number "${n}" gave ${r.status}`);
  }
});

test("the lookup follows staff changes", async () => {
  const { json } = await place(takeaway(lines(["burger"])));
  await srv.api("PATCH", `/api/orders/${json.number}/status`, { token, body: { status: "in_progress" } });
  assert.equal((await srv.api("GET", `/api/orders/${json.number}/status?t=${json.token}`)).json.status, "in_progress");
});

test("the status lookup is rate limited per address", async () => {
  const ip = "198.51.100.77";
  let last;
  for (let i = 0; i < 61; i++) last = await srv.api("GET", "/api/orders/100001/status?t=x", { ip });
  assert.equal(last.status, 429);
});

// ---------- staff ----------
test("staff see full order details, newest first, and never the customer's secret", async () => {
  await place(takeaway(lines(["burger"]), { name: "First" }));
  await place({ type: "dinein", name: "Second", table: "4", note: "no rush", items: lines(["latte", 2, "extra hot"]) });
  const list = await staffList();
  assert.deepEqual(list.map(o => o.customer), ["Second", "First"]);
  const o = list[0];
  assert.equal(o.table_no, "4"); assert.equal(o.note, "no rush");
  assert.deepEqual(o.items, [{ ref: "latte", name: "Latte", parts: "", unitPrice: 4, qty: 2, note: "extra hot" }]);
  assert.equal(o.subtotal, 8); assert.equal(o.total, 8);
  assert.ok(!("track_token" in o));
});

test("staff can filter by status, and unknown statuses are refused", async () => {
  const a = (await place(takeaway(lines(["burger"])))).json, b = (await place(takeaway(lines(["latte"])))).json;
  await srv.api("PATCH", `/api/orders/${b.number}/status`, { token, body: { status: "ready" } });
  assert.deepEqual((await staffList("?status=ready")).map(o => o.number), [b.number]);
  assert.deepEqual((await staffList("?status=open")).map(o => o.number), [a.number]);
  assert.equal((await srv.api("GET", "/api/orders?status=bogus", { token })).status, 400);
});

test("every real status can be set, including cancel and restore", async () => {
  const { json } = await place(takeaway(lines(["burger"])));
  for (const status of ["picked", "in_progress", "ready", "cancelled", "open"]) {
    const r = await srv.api("PATCH", `/api/orders/${json.number}/status`, { token, body: { status } });
    assert.equal(r.status, 200, status); assert.equal(r.json.status, status);
  }
});

test("retired and made-up statuses are refused", async () => {
  const { json } = await place(takeaway(lines(["burger"])));
  for (const status of ["completed", "done", "new", "preparing", "", "READY", null, 5, undefined]) {
    assert.equal((await srv.api("PATCH", `/api/orders/${json.number}/status`, { token, body: { status } })).status, 400, String(status));
  }
});

test("changing the status of an order that does not exist is 404", async () => {
  assert.equal((await srv.api("PATCH", "/api/orders/999999/status", { token, body: { status: "ready" } })).status, 404);
});

test("odd order numbers when changing status are 404, never a server error", async () => {
  for (const n of ["abc", "-1", "1.5", "99999999999999", "NaN"]) {
    const r = await srv.api("PATCH", `/api/orders/${n}/status`, { token, body: { status: "ready" } });
    assert.equal(r.status, 404, `number "${n}" gave ${r.status}`);
  }
});

test("only a logged-in member of staff can change a status", async () => {
  const { json } = await place(takeaway(lines(["burger"])));
  assert.equal((await srv.api("PATCH", `/api/orders/${json.number}/status`, { body: { status: "ready" } })).status, 401);
  assert.equal((await srv.api("GET", `/api/orders/${json.number}/status?t=${json.token}`)).json.status, "open");
});
