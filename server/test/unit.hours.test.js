import "./env.js";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isOpen } from "../src/orders.js";
import { fixture, closeDb } from "./helpers.js";

after(closeDb);

// 2026-11-02 is a Monday. The fixture is open 09:00-17:00 every day, time zone UTC.
const base = () => ({ ...fixture().settings, useHours: true });
const at = iso => new Date(iso);

test("hours switched off: always open", () => {
  assert.equal(isOpen({ ...base(), useHours: false }, at("2026-11-02T03:00:00Z")), true);
});

test("paused: closed even inside opening hours", () => {
  assert.equal(isOpen({ ...base(), pauseOrders: true }, at("2026-11-02T12:00:00Z")), false);
});

test("inside the opening hours", () => {
  assert.equal(isOpen(base(), at("2026-11-02T12:00:00Z")), true);
});

test("opening minute is open, minute before is closed", () => {
  assert.equal(isOpen(base(), at("2026-11-02T09:00:00Z")), true);
  assert.equal(isOpen(base(), at("2026-11-02T08:59:00Z")), false);
});

test("closing minute is already closed", () => {
  assert.equal(isOpen(base(), at("2026-11-02T16:59:00Z")), true);
  assert.equal(isOpen(base(), at("2026-11-02T17:00:00Z")), false);
});

test("a day marked closed", () => {
  const s = base(); s.hours.mon = { closed: true, open: "09:00", close: "17:00" };
  assert.equal(isOpen(s, at("2026-11-02T12:00:00Z")), false);
  assert.equal(isOpen(s, at("2026-11-03T12:00:00Z")), true);   // Tuesday is still open
});

test("past midnight: Friday 18:00 to 02:00 is open on Saturday 01:00 and closed at 03:00", () => {
  const s = base(); s.hours.fri = { closed: false, open: "18:00", close: "02:00" };
  assert.equal(isOpen(s, at("2026-11-06T19:00:00Z")), true);    // Friday evening
  assert.equal(isOpen(s, at("2026-11-07T01:00:00Z")), true);    // Saturday 01:00, still Friday's shift
  assert.equal(isOpen(s, at("2026-11-07T03:00:00Z")), false);   // Saturday 03:00, before Saturday opens at 09:00
});

test("past midnight: the early hours belong to the previous day's shift even if today is closed", () => {
  const s = base(); s.hours.fri = { closed: false, open: "18:00", close: "02:00" }; s.hours.sat = { closed: true, open: "", close: "" };
  assert.equal(isOpen(s, at("2026-11-07T01:00:00Z")), true);
});

test("uses the shop's time zone, not the server's", () => {
  const s = { ...base(), timezone: "Asia/Jerusalem" };   // UTC+2 in November
  assert.equal(isOpen(s, at("2026-11-02T08:00:00Z")), true);    // 10:00 local
  assert.equal(isOpen(s, at("2026-11-02T06:30:00Z")), false);   // 08:30 local
  assert.equal(isOpen(s, at("2026-11-02T15:30:00Z")), false);   // 17:30 local
});

test("an unknown time zone never blocks customers", () => {
  assert.equal(isOpen({ ...base(), timezone: "Mars/Base" }, at("2026-11-02T03:00:00Z")), true);
});

test("hours missing entirely: treated as open", () => {
  const s = base(); delete s.hours;
  assert.equal(isOpen(s, at("2026-11-02T03:00:00Z")), true);
});
