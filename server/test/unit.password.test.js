import "./env.js";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { checkPassword, hashPassword } from "../src/auth.js";
import { closeDb } from "./helpers.js";

after(closeDb);

test("the right password matches", async () => {
  assert.equal(await checkPassword("Aa@123456", await hashPassword("Aa@123456")), true);
});

test("a wrong password does not match", async () => {
  assert.equal(await checkPassword("Aa@123457", await hashPassword("Aa@123456")), false);
});

test("the stored value is a salted hash, never the password", async () => {
  const h = await hashPassword("Aa@123456");
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.ok(!h.includes("Aa@123456"));
});

test("the same password gets a different hash each time", async () => {
  assert.notEqual(await hashPassword("same"), await hashPassword("same"));
});

test("unicode and very long passwords work", async () => {
  const pw = "كلمة-السر-" + "x".repeat(150);
  assert.equal(await checkPassword(pw, await hashPassword(pw)), true);
});

test("a damaged stored hash is a plain mismatch, not a crash", async () => {
  for (const bad of ["", "nonsense", "scrypt$zz$zz", "scrypt$$", "bcrypt$a$b", "scrypt$00$"]) {
    assert.equal(await checkPassword("anything", bad), false, `stored value ${JSON.stringify(bad)}`);
  }
});
