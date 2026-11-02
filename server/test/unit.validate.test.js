import "./env.js";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { validateMenu } from "../src/menuwrite.js";
import { fixture, closeDb } from "./helpers.js";

after(closeDb);

test("the fixture menu is valid", () => {
  assert.equal(validateMenu(fixture()), "");
});

// [what is wrong, how to break the menu, text the message must contain]
const bad = [
  ["no document", () => null, "menu is missing"],
  ["no settings", d => { delete d.settings; }, "settings"],
  ["negative delivery fee", d => { d.settings.deliveryFee = -1; }, "negative"],
  ["negative minimum order", d => { d.settings.minDeliveryOrder = -5; }, "negative"],
  ["WhatsApp too short", d => { d.settings.whatsapp = "12345"; }, "WhatsApp"],
  ["WhatsApp with letters only", d => { d.settings.whatsapp = "abc"; }, "WhatsApp"],
  ["unknown time zone", d => { d.settings.useHours = true; d.settings.timezone = "Mars/Base"; }, "time zone"],
  ["a day missing from the hours", d => { d.settings.useHours = true; delete d.settings.hours.tue; }, "tue"],
  ["open day without times", d => { d.settings.useHours = true; d.settings.hours.mon = { closed: false, open: "", close: "" }; }, "mon"],
  ["delivery area without a name", d => { d.settings.deliveryAreas[0].en = "  "; }, "English name"],
  ["delivery area with negative fee", d => { d.settings.deliveryAreas[0].fee = -2; }, "fee"],
  ["no menus at all", d => { d.venues = []; }, "at least one"],
  ["two menus with the same name", d => { d.venues[1].key = "Restaurant"; }, "both called"],
  ["section without a title", d => { d.venues[0].sections[0].en = ""; }, "no English title"],
  ["item id with a space", d => { d.venues[0].sections[0].items[0].id = "bad id"; }, "invalid id"],
  ["two items with one id", d => { d.venues[0].sections[0].items[1].id = "burger"; }, "share the id"],
  ["item without a title", d => { d.venues[0].sections[0].items[0].en = "   "; }, "no English title"],
  ["negative price", d => { d.venues[0].sections[0].items[0].price = -0.01; }, "invalid price"],
  ["price as text", d => { d.venues[0].sections[0].items[0].price = "10"; }, "invalid price"],
  ["price is infinity", d => { d.venues[0].sections[0].items[0].price = Infinity; }, "invalid price"],
  ["discount over 100", d => { d.venues[0].sections[0].items[0].discount = 101; }, "discount"],
  ["fractional discount", d => { d.venues[0].sections[0].items[0].discount = 10.5; }, "discount"],
  ["very long description", d => { d.venues[0].sections[0].items[0].dEn = "x".repeat(501); }, "too long"],
  ["two combos with one id", d => { d.bundles[1].id = "combo1"; }, "share the id"],
  ["combo without a title", d => { d.bundles[0].en = ""; }, "title"],
  ["combo with negative price", d => { d.bundles[0].price = -1; }, "invalid price"],
  ["combo with no items", d => { d.bundles[0].items = []; }, "no items"],
  ["combo item that does not exist", d => { d.bundles[0].items[0].id = "ghost"; }, "no longer exists"],
  ["combo quantity zero", d => { d.bundles[0].items[0].qty = 0; }, "quantity"],
  ["combo quantity fraction", d => { d.bundles[0].items[0].qty = 1.5; }, "quantity"],
  ["combo quantity over 50", d => { d.bundles[0].items[0].qty = 51; }, "quantity"],
];

for (const [name, mutate, expected] of bad) {
  test(`refuses: ${name}`, () => {
    const d = fixture();
    const broken = mutate(d) === null ? null : d;
    const problem = validateMenu(broken);
    assert.notEqual(problem, "", "should have been refused");
    assert.ok(problem.toLowerCase().includes(expected.toLowerCase()), `message "${problem}" should mention "${expected}"`);
  });
}

test("accepts a menu with no combos and no photos", () => {
  const d = fixture(); d.bundles = [];
  assert.equal(validateMenu(d), "");
});

test("accepts opening hours that run past midnight", () => {
  const d = fixture(); d.settings.useHours = true; d.settings.hours.fri = { closed: false, open: "18:00", close: "02:00" };
  assert.equal(validateMenu(d), "");
});
