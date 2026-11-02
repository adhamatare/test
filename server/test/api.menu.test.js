import "./env.js";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { freshDb, startServer, createAdmin, loginAs, closeDb, fixture, pool } from "./helpers.js";

let srv, token;
const items = m => m.venues.flatMap(v => v.sections.flatMap(s => s.items));
const getMenu = async () => (await srv.api("GET", "/api/menu")).json;
const put = (menu, baseVersion, tok = token) => srv.api("PUT", "/api/menu", { token: tok, body: { ...menu, baseVersion } });
const editable = async () => { const m = await getMenu(); const v = m.version; delete m.version; return { m, v }; };

before(async () => { srv = await startServer(); });
beforeEach(async () => { await freshDb(); await createAdmin(); token = await loginAs(srv.api); });
after(async () => { await srv.close(); await closeDb(); });

test("anyone can read the menu, and it carries a version", async () => {
  const r = await srv.api("GET", "/api/menu");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.ok(Number.isInteger(r.json.version));
  assert.equal(items(r.json).length, 6);
  assert.equal(r.json.bundles.length, 2);
  assert.equal(r.json.settings.deliveryAreas.length, 2);
});

test("the menu round-trips exactly through the database", async () => {
  const m = await getMenu(); delete m.version;
  const expected = fixture();
  assert.deepEqual(m.venues, expected.venues);
  assert.deepEqual(m.bundles, expected.bundles);
  assert.deepEqual(m.settings, expected.settings);
});

test("saving needs a login", async () => {
  const { m, v } = await editable();
  assert.equal((await put(m, v, "")).status, 401);
  assert.equal((await put(m, v, "not-a-real-token")).status, 401);
});

test("saving needs the version that was loaded", async () => {
  const { m } = await editable();
  const r = await srv.api("PUT", "/api/menu", { token, body: m });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /version/i);
});

test("a save is applied and bumps the version", async () => {
  const { m, v } = await editable();
  items(m).find(i => i.id === "burger").price = 11.5;
  const r = await put(m, v);
  assert.equal(r.status, 200);
  assert.equal(r.json.version, v + 1);
  const after = await getMenu();
  assert.equal(after.version, v + 1);
  assert.equal(items(after).find(i => i.id === "burger").price, 11.5);
  assert.equal(items(after).length, 6, "nothing else was lost");
});

test("item order, sections and combos survive a save", async () => {
  const { m, v } = await editable();
  m.venues[0].sections[0].items.reverse();
  await put(m, v);
  const after = await getMenu();
  assert.deepEqual(after.venues[0].sections[0].items.map(i => i.id), ["secret", "soup", "pizza", "burger"]);
  assert.deepEqual(after.bundles.map(b => b.id), ["combo1", "combo2"]);
});

test("a stale version is refused with 409 and changes nothing", async () => {
  const { m, v } = await editable();
  const first = JSON.parse(JSON.stringify(m)); items(first).find(i => i.id === "burger").price = 1;
  assert.equal((await put(first, v)).status, 200);
  const second = JSON.parse(JSON.stringify(m)); items(second).find(i => i.id === "latte").price = 99;
  const r = await put(second, v);   // still using the old version
  assert.equal(r.status, 409);
  assert.match(r.json.error, /changed somewhere else/);
  const after = await getMenu();
  assert.equal(items(after).find(i => i.id === "latte").price, 4, "the stale save must not apply");
  assert.equal(items(after).find(i => i.id === "burger").price, 1, "the first save must still be there");
});

test("two saves at the same moment: exactly one wins", async () => {
  const { m, v } = await editable();
  const a = JSON.parse(JSON.stringify(m)); items(a)[0].price = 1;
  const b = JSON.parse(JSON.stringify(m)); items(b)[0].price = 2;
  const [ra, rb] = await Promise.all([put(a, v), put(b, v)]);
  assert.deepEqual([ra.status, rb.status].sort(), [200, 409]);
  assert.equal((await getMenu()).version, v + 1);
});

// A bad save must be refused AND leave the stored menu untouched.
const refused = [
  ["negative price", m => { items(m)[0].price = -1; }],
  ["discount over 100", m => { items(m)[0].discount = 150; }],
  ["duplicate item id", m => { items(m)[1].id = items(m)[0].id; }],
  ["combo naming a missing item", m => { m.bundles[0].items[0].id = "ghost"; }],
  ["bad WhatsApp number", m => { m.settings.whatsapp = "1"; }],
  ["no menus", m => { m.venues = []; }],
];
for (const [name, mutate] of refused) {
  test(`refuses and keeps the old menu: ${name}`, async () => {
    const { m, v } = await editable();
    mutate(m);
    const r = await put(m, v);
    assert.equal(r.status, 400);
    assert.ok(r.json.error);
    const after = await getMenu();
    assert.equal(after.version, v, "version must not move");
    assert.equal(items(after).length, 6);
    assert.equal(items(after)[0].price, 10);
  });
}

test("the same item listed twice in a combo is merged", async () => {
  const { m, v } = await editable();
  m.bundles = [{ id: "dup", en: "Dup", price: 5, items: [{ id: "latte", qty: 1 }, { id: "latte", qty: 2 }] }];
  assert.equal((await put(m, v)).status, 200);
  const b = (await getMenu()).bundles[0];
  assert.deepEqual(b.items, [{ id: "latte", qty: 3 }]);
});

test("removing an item removes it from combos too", async () => {
  const { m, v } = await editable();
  m.venues[1].sections[0].items = m.venues[1].sections[0].items.filter(i => i.id !== "latte");
  m.bundles = m.bundles.filter(b => b.items.every(r => r.id !== "latte"));   // the admin page does this before saving
  assert.equal((await put(m, v)).status, 200);
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM bundle_items WHERE item_id = 'latte'");
  assert.equal(rows[0].n, 0);
});

test("a very large menu body is refused", async () => {
  const { m, v } = await editable();
  m.settings.junk = "x".repeat(1_200_000);
  const r = await put(m, v);
  assert.equal(r.status, 413);
});

test("special characters and Arabic survive", async () => {
  const { m, v } = await editable();
  const it = items(m).find(i => i.id === "burger");
  it.en = `Burger "Deluxe" <b>&</b> 'x'`; it.ar = "برجر لحم 🍔"; it.dEn = "line1\nline2";
  assert.equal((await put(m, v)).status, 200);
  const got = items(await getMenu()).find(i => i.id === "burger");
  assert.equal(got.en, it.en); assert.equal(got.ar, it.ar); assert.equal(got.dEn, it.dEn);
});

// ---- photos ----
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7), Buffer.from([0xff, 0xd9])]);

test("uploading a photo needs a login", async () => {
  assert.equal((await srv.api("POST", "/api/images", { raw: jpeg })).status, 401);
});

test("a JPEG upload is stored and served back unchanged, cached for a year", async () => {
  const up = await srv.api("POST", "/api/images", { token, raw: jpeg });
  assert.equal(up.status, 201);
  assert.match(up.json.path, /^\/api\/images\/[a-f0-9]{16}\.jpg$/);
  const img = await srv.api("GET", up.json.path);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/jpeg");
  assert.equal(img.headers.get("x-content-type-options"), "nosniff");
  assert.match(img.headers.get("cache-control"), /immutable/);
  assert.ok(img.buf.equals(jpeg));
});

test("each upload gets its own address", async () => {
  const a = await srv.api("POST", "/api/images", { token, raw: jpeg });
  const b = await srv.api("POST", "/api/images", { token, raw: jpeg });
  assert.notEqual(a.json.path, b.json.path);
});

test("things that are not JPEGs are refused", async () => {
  assert.equal((await srv.api("POST", "/api/images", { token, raw: Buffer.from("<script>alert(1)</script>") })).status, 400);
  assert.equal((await srv.api("POST", "/api/images", { token, raw: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]) })).status, 400);   // PNG signature
  assert.equal((await srv.api("POST", "/api/images", { token, raw: jpeg, type: "text/html" })).status, 400);
});

test("an upload over 3 MB is refused", async () => {
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(4 * 1024 * 1024)]);
  assert.equal((await srv.api("POST", "/api/images", { token, raw: big })).status, 413);
});

test("missing and odd image ids are 404, never an error or a file read", async () => {
  for (const id of ["0000000000000000.jpg", "..%2f..%2fetc%2fpasswd", "x.jpg", "ABCDEF0123456789.jpg", "a".repeat(200)]) {
    assert.equal((await srv.api("GET", "/api/images/" + id)).status, 404, id);
  }
});
