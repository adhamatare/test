# Tests

```
npm test
```

Runs about 140 checks in roughly 20 seconds. They need PostgreSQL running and `DATABASE_URL` set (the same `.env` as the app).

## Your real data is safe
- The tests use their own database, `<your database name>_test` (for example `menu_test`). It is created automatically.
- `test/env.js` refuses to run unless the database name ends in `_test`, and refuses remote hosts unless `TEST_ALLOW_REMOTE=1`.
- Each test file wipes and refills the test database from `test/fixture.js`, a small menu with known prices.

## What is covered
| File | What it checks |
|---|---|
| `unit.validate.test.js` | Every rule the menu save enforces (prices, discounts, ids, combos, hours, WhatsApp number) |
| `unit.hours.test.js` | Opening hours: time zones, closing minute, overnight shifts, closed days, pause |
| `unit.password.test.js` | Password hashing, wrong and damaged hashes |
| `api.menu.test.js` | Reading and saving the menu, version conflicts, combos, photos |
| `api.orders.test.js` | Server-side pricing, availability, delivery rules, hours, status lookup, staff controls |
| `api.auth.test.js` | Login, sessions, expiry, logout, lockout, staff-only endpoints |
| `setup.test.js` | First start (seed menu, first admin), repeated starts, upgrading an old database |

## Adding a test
Copy the top of any `api.*.test.js` (first import must be `./env.js`), use `freshDb()` to reset the data and `startServer()` to get an `api(method, path, options)` helper.

If a test fails, fix the code or, if the rule changed on purpose, change the test and say why in the commit.
