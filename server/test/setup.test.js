import "./env.js";
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { freshDb, closeDb, pool } from "./helpers.js";
import { setup } from "../src/setup.js";

after(closeDb);
beforeEach(async () => {
  await freshDb({ seed: false });
  delete process.env.ADMIN_USERNAME; delete process.env.ADMIN_PASSWORD;
});

const count = async table => (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

test("first start on an empty database loads the menu from menu.json", async () => {
  assert.equal(await count("items"), 0);
  await setup();
  assert.ok(await count("venues") >= 1);
  assert.ok(await count("items") >= 1);
  assert.ok((await pool.query("SELECT count(*)::int AS n FROM settings")).rows[0].n >= 5);
});

test("a later start never overwrites a menu that is already there", async () => {
  await setup();
  await pool.query("UPDATE items SET price = 123.45 WHERE id = (SELECT id FROM items ORDER BY id LIMIT 1)");
  const before = (await pool.query("SELECT version FROM menu_meta")).rows[0].version;
  await setup(); await setup();
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM items WHERE price = 123.45")).rows[0].n, 1);
  assert.equal((await pool.query("SELECT version FROM menu_meta")).rows[0].version, before);
});

test("the first admin is created from the environment, once", async () => {
  process.env.ADMIN_USERNAME = "owner"; process.env.ADMIN_PASSWORD = "a-long-password";
  await setup();
  const { rows } = await pool.query("SELECT username, password_hash FROM users");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, "owner");
  assert.ok(rows[0].password_hash.startsWith("scrypt$"));
  assert.ok(!rows[0].password_hash.includes("a-long-password"));
  process.env.ADMIN_USERNAME = "second"; process.env.ADMIN_PASSWORD = "another-long-one";
  await setup();
  assert.equal(await count("users"), 1, "an existing user means no new admin is created");
});

test("too short a password from the environment creates no admin", async () => {
  process.env.ADMIN_USERNAME = "owner"; process.env.ADMIN_PASSWORD = "short";
  await setup();
  assert.equal(await count("users"), 0);
});

test("no admin variables means no admin", async () => {
  await setup();
  assert.equal(await count("users"), 0);
});

test("the schema can be applied again and again without harm", async () => {
  await setup(); await setup(); await setup();
  assert.ok(await count("items") >= 1);
});

test("an old database with the first status names is upgraded", async () => {
  await setup();
  await pool.query("ALTER TABLE orders DROP CONSTRAINT orders_status_check");
  await pool.query(`INSERT INTO orders (type, customer, subtotal, total, status) VALUES
    ('takeaway','a',1,1,'new'),('takeaway','b',1,1,'preparing'),('takeaway','c',1,1,'done'),('takeaway','d',1,1,'completed'),('takeaway','e',1,1,'ready')`);
  await setup();
  const { rows } = await pool.query("SELECT customer, status FROM orders ORDER BY customer");
  assert.deepEqual(rows.map(r => r.status), ["open", "in_progress", "ready", "ready", "ready"]);
  await assert.rejects(pool.query("INSERT INTO orders (type, customer, subtotal, total, status) VALUES ('takeaway','x',1,1,'completed')"));
});
