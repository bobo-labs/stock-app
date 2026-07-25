# Bakery Stock

A responsive, touch-friendly inventory dashboard for bakeries and pastry shops. Spanish is the default language, with a one-tap English/Spanish toggle. It supports product creation, editing, stock-in/stock-out adjustments, low-stock alerts, expiry dates, search, categories, and a complete activity trail.

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm install
npm run build
npm start
```

Open `http://localhost:3000`. Without a `DATABASE_URL`, the app stores data in `data/inventory.json`.

For development, run the API and Vite in separate terminals:

```bash
npm run dev:server
npm run dev
```

Then open `http://localhost:5173`.

## Deploy to Railway

1. Push this project to GitHub and create a Railway project from the repository.
2. Add a PostgreSQL service to the Railway project.
3. Connect the Postgres `DATABASE_URL` variable to the app service.
4. Deploy. The included `railway.toml` builds the frontend, starts the server, and configures the health check.

The database tables are created automatically on first start.

### Alternative: Railway volume

For a very small single-instance installation, you can skip PostgreSQL, attach a persistent Railway volume mounted at `/data`, and set `DATA_PATH=/data/inventory.json`. PostgreSQL is recommended when the app might run more than one instance.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port; Railway supplies this automatically. |
| `DATABASE_URL` | PostgreSQL connection string. |
| `DATA_PATH` | Local JSON storage path when PostgreSQL is not configured. |
| `SEED_DEMO_DATA` | Set to `true` to add sample products to a new local database. |

## Current scope

This first release intentionally focuses on fast counter operations. Before using it on a public URL, add staff authentication. Future additions could include suppliers, barcode scanning, recipes, production batches, waste reporting, exports, and role-based access.
