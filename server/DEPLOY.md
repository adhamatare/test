# Deploying the menu system

Pages (`menu.html`, `admin.html`, `orders.html`) stay on GitHub Pages. The API runs on Render (free) with a free PostgreSQL from Neon.
The move is staged so the live site keeps working until you decide to switch.

**Secrets:** type passwords and connection strings only into the Neon and Render dashboards. Never paste them into chat, files, issues or commits.

```
Customers ─► menu.html (GitHub Pages) ─► API on Render ─► PostgreSQL on Neon
Staff ─────► orders.html / admin.html ──┘
```

## Stage 1: database (Neon)
1. Sign up at https://neon.tech and create a project in a region near your customers.
2. Copy the **connection string** (starts with `postgresql://`, ends with `sslmode=require`).

## Stage 2: API (Render), from the `backend-admin` branch
1. Sign up at https://render.com with your GitHub account.
2. **New > Blueprint**, pick the `adhamatare/test` repository and the branch **`backend-admin`** (it holds the new code; `main` is still the old site).
3. Fill in the three secret values Render asks for:
   - `DATABASE_URL`: the Neon connection string
   - `ADMIN_USERNAME`: for example `adham`
   - `ADMIN_PASSWORD`: a **new, strong** password (do not reuse one that has appeared in a chat)
4. Deploy. On first start the server creates the tables, loads `menu.json` once, and creates your admin.
5. Open `https://<your-service>.onrender.com/api/health`. You should see `{"ok":true}`.
6. In Render > Environment, **delete `ADMIN_PASSWORD`**. It is only used while there are no users.

At this point nothing on the live site has changed.

## Stage 3: test it without touching the live site
Use test pages with the server address in the link, for example `menu.html?api=https://<your-service>.onrender.com`, opened from a local copy (ask Claude to run the checks for you). Check:
- [ ] the menu loads and shows the right items and prices
- [ ] place a test order: it gets a number and the status strip appears
- [ ] `orders.html?api=...` signs in and shows the order; moving it through Picked, In progress, Ready updates the customer's strip
- [ ] `admin.html?api=...` signs in; change a price and save; the menu shows it at once
- [ ] upload a photo; it shows on the menu
- [ ] cancel the test order

## Stage 4: cutover (do it when the shop is quiet)
1. **Pause edits** in the old admin on the live site.
2. **Bring the database up to date** with whatever was edited in the old admin since Stage 2. Merge the latest `main` into `backend-admin`, then, from the `server` folder on your PC, in PowerShell:
   ```powershell
   $env:DATABASE_URL = "<the Neon connection string>"
   npm run import
   Remove-Item Env:DATABASE_URL
   ```
   This replaces the menu data (not orders). Typing the string into your own terminal keeps it out of files.
3. In `config.js` set `window.MENU_API = "https://<your-service>.onrender.com";`
4. Merge `backend-admin` into `main` and push. GitHub Pages updates in 1 to 2 minutes. The printed QR codes keep working: the address `menu.html` does not change.
5. Repeat the Stage 3 checklist on the live addresses, with a real test order.
6. Tidy up: remove `http://localhost:8765` from `ALLOWED_ORIGINS` in Render, and make sure `ADMIN_PASSWORD` is gone.

## Rollback (takes about 2 minutes)
Set `window.MENU_API = "";` in `config.js` and push. The site goes back to `menu.json` and WhatsApp-only ordering. Orders already saved stay in the database. After the cutover `admin.html` needs the server, so to keep the fallback copy fresh run `npm run export-menu` now and then (with `DATABASE_URL` set as above) and commit `menu.json`. If the server is ever unreachable, customers see a notice that the menu may be out of date.

## Keeping the server awake (optional)
A free Render service sleeps after about 15 minutes without visits; the next customer then waits 30 to 60 seconds. The workflow `.github/workflows/keepalive.yml` pings the server every 10 minutes. To switch it on, add a repository **variable** (not a secret) named `API_URL` with your service address (Settings > Secrets and variables > Actions > Variables). It calls `/api/ping`, which does not touch the database, so the database can still sleep. GitHub disables scheduled workflows after 60 days without repository activity; re-enable it in the Actions tab if that happens.

## Limits of the free plans
- Render free: sleeps when idle (above), about 750 running hours a month.
- Neon free: pauses when idle and wakes on the next request (about a second); limited storage. Photos are stored in the database, about 50 to 150 KB each after shrinking.
- Neon keeps only a short history for restores on the free plan. `npm run export-menu` backs up the menu; there is no orders export yet.

## Updating later
Push to the branch Render follows; it redeploys by itself and applies schema changes at start. Run `npm test` in `server/` first (about 150 checks, 20 seconds; see `TESTING.md`).

## If something goes wrong
- **Menu shows "could not reach the live menu":** open `/api/health` on the server. A 503 or timeout means the server or database is down or waking up; check Render > Logs.
- **Orders page says "Cannot reach the server":** same check; also confirm the page address is allowed in `ALLOWED_ORIGINS`.
- **Locked out of staff login:** five wrong passwords lock an address for 15 minutes. To change a password, run `npm run create-user -- <name>` with `DATABASE_URL` set as above.
