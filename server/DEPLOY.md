# Deploying the menu API

The pages stay on GitHub Pages. The API runs on Render (free) and uses a free PostgreSQL from Neon.
Never paste passwords or connection strings into chat, issues or commits. Type them only into the dashboards below.

## 1. Database (Neon)
1. Sign up at https://neon.tech and create a project (pick a region close to your customers).
2. Copy the **connection string** (it starts with `postgresql://` and ends with `sslmode=require`).

## 2. API (Render)
1. Sign up at https://render.com with your GitHub account.
2. **New > Blueprint**, choose the `adhamatare/test` repository. Render reads `render.yaml`.
3. Fill the three secret values it asks for:
   - `DATABASE_URL`: the Neon connection string
   - `ADMIN_USERNAME`: your admin name (for example `adham`)
   - `ADMIN_PASSWORD`: a strong password you choose (at least 8 characters)
4. Deploy. The first start creates the tables, loads `menu.json` once and creates your admin.
5. Open `https://<your-service>.onrender.com/api/health`. It should show `{"ok":true}`.
6. In Render > Environment, **delete `ADMIN_PASSWORD`**. It is only used while there are no users.

## Good to know
- The free Render service sleeps after about 15 minutes without visits, and the first request after that takes roughly 30 to 60 seconds. A paid plan removes this.
- Neon's free database also pauses when idle and wakes by itself.
- To change the admin password later, run `npm run create-user -- <name>` against the same `DATABASE_URL`, or ask for a reset endpoint.
- `ALLOWED_ORIGINS` lists the sites allowed to call the API from a browser. Add your custom domain there when you have one.
