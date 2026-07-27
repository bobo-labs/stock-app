# Bakery Stock — Project and Conversation Backup

Updated: 2026-07-27

This document records the project decisions, implementation details, deployment instructions, testing history, and useful context from the conversation so the project can be resumed later.

## Repository

- GitHub: https://github.com/bobo-labs/stock-app
- Main branch: `main`
- Initial application commit: `bc269d1 Build bakery stock dashboard`
- Current project directory: `F:\stock-app`
- No credentials, passwords, database URLs, or API keys are stored in this document.

## Business purpose

The project is a shared inventory dashboard for the family bakery/pastry business. It is designed for fast counter operations when products or ingredients arrive, when stock is sold or removed, and when staff need to see the current inventory.

The intended users are bakery staff working from:

- The Elo X-Series touchscreen computer at the counter.
- Phones used by staff.
- Desktop browsers used by the bakery owners or managers.

The primary customer language is Spanish, so Spanish is the default interface language. English is also available.

## Hardware context

The original computer information supplied in the conversation was:

- Manufacturer: Elo Touch Solutions.
- Device type: 15-inch all-in-one touch computer, commonly used for POS or kiosk systems.
- Model line: X-Series.
- Model number: ESY15X3.
- Part number: E141645.
- SKU string: `ESY15X3-8UWA-1-ST-BZ-8G-3H-W7-64-BK`.
- Approximate display: 15-inch touchscreen, commonly 1024×768.
- Processor: Intel Core i3 class.
- Memory: 8 GB RAM.
- Storage: approximately 320 GB HDD based on the SKU interpretation.
- Operating system: Windows 7 64-bit.
- Power: approximately 19–19.5V DC at 7.7A, around 150W through an external power brick.

This led to the decision to keep the dashboard lightweight, touch-friendly, responsive, and usable at 1024×768. The app is intended for modern Chromium/Firefox-class browsers; Internet Explorer is not a target. Windows 7 should not be used for general public internet browsing without considering an operating-system upgrade.

## Conversation decisions

### Brainstorming phase

The initial request was to brainstorm useful applications for the old Elo PC rather than immediately build one. Ideas included:

- Bakery stock-in and inventory tracking.
- Production and baking quantity tracking.
- Expiry and waste monitoring.
- Simple touch POS.
- Order and pickup tracking.
- Recipe and ingredient calculations.
- Low-stock ordering alerts.
- Kitchen preparation board.

The chosen direction was a bakery counter dashboard centered on fast inventory updates.

### Build request

The requested application characteristics were:

- Runs on the web and can be deployed to Railway.
- Works in browsers on phones and desktops.
- Responsive and usable on the Elo touchscreen.
- Simple, minimal, polished interface.
- Soft animations and strong visual design.
- Add and edit stock.
- View current inventory.
- Include useful operational features beyond the first stock-entry action.

### Design references used

The interface direction was informed by:

- Shopify Polaris layout guidance: use sections/cards for scanning, one primary action per area, and tables for desktop summaries.
- Google Android accessibility guidance: touch targets should generally be at least 48dp with spacing between controls.
- Responsive design guidance emphasizing mobile-first layouts, touch interactions, and not relying on hover.

The result is a warm bakery palette, cocoa primary actions, sage/amber/rose status colors, card-based dashboard sections, large touch controls, mobile bottom navigation, and a desktop sidebar.

## Current feature set

### Dashboard

- Live product count.
- Total units on hand.
- Products requiring attention.
- Products expiring soon.
- Low-stock list with quick stock-update actions.
- Product count by category.
- Recent activity list.

### Inventory

- Add a product.
- Edit product details.
- Search by product name, category, or SKU.
- Filter by all products, low stock, or category.
- See available quantity and unit.
- See stock status: in stock, low stock, or out of stock.
- See expiry dates and expiry warnings.
- Update stock directly from each product.

### Stock movements

- Stock in.
- Stock out.
- Set/correct the total count.
- Optional notes such as delivery, sale, or waste.
- Activity history records the movement, quantity change, balance after update, note, timestamp, and product name.

### Languages

- Spanish is the default on a new browser.
- English is available through the `ES / EN` toggle.
- Language preference is saved in browser local storage under `bakery-language`.
- Categories and units are translated for display while their stored values remain stable in English internally.
- The document language attribute updates between `es` and `en` for accessibility.

## Technical architecture

```text
Phone / desktop / Elo touchscreen
              |
         React + Vite UI
              |
       Express JSON API
              |
     PostgreSQL on Railway
```

### Frontend

- React 19.
- Vite.
- Lucide React icons.
- CSS-only layout, animations, responsive breakpoints, and reduced-motion support.
- No image-heavy assets or external font dependencies are required for the core UI.

Important frontend files:

- `src/App.jsx`: dashboard, inventory, activity pages, forms, modals, navigation, and language toggle.
- `src/i18n.js`: English/Spanish dictionaries, language persistence, translated categories/units, and localized date/time formatting.
- `src/api.js`: fetch wrapper and API methods.
- `src/styles.css`: full responsive visual system.
- `src/main.jsx`: React entry point and language provider.

### Backend

- Node.js 20 or newer.
- Express 5.
- Compression middleware.
- PostgreSQL client through `pg`.
- Static production serving from `dist`.
- Health endpoint at `/api/health`.

Important backend files:

- `server/index.js`: Express server, validation, API routes, static hosting, health check, and graceful shutdown.
- `server/store.js`: PostgreSQL store with a local JSON fallback.

### Persistence behavior

When `DATABASE_URL` exists, the app uses PostgreSQL and automatically creates the `items` and `movements` tables on startup.

When `DATABASE_URL` is absent, the app uses a JSON file at `DATA_PATH`, or `data/inventory.json` by default. This is suitable for local development. Railway’s normal container filesystem is not sufficient for production persistence unless a volume is attached, so Railway PostgreSQL is the recommended production configuration.

## Database model

### `items`

- `id` UUID.
- `name`.
- `category`.
- `unit`.
- `quantity`.
- `low_stock_threshold`.
- `sku`.
- `expiry_date`.
- `created_at`.
- `updated_at`.

### `movements`

- `id` UUID.
- `item_id`.
- `item_name`.
- `type`: `stock_in`, `stock_out`, or `adjustment`.
- `quantity`: the signed quantity change.
- `balance_after`.
- `note`.
- `created_at`.

Stock adjustments use a database row lock in PostgreSQL so simultaneous updates to one product are handled safely.

## API routes

- `GET /api/health`: returns `{ ok: true }` if the server and store initialized.
- `GET /api/items`: returns all products.
- `POST /api/items`: creates a product and optionally records opening stock.
- `PATCH /api/items/:id`: updates product details.
- `POST /api/items/:id/adjust`: records stock in, stock out, or an adjustment.
- `GET /api/movements?limit=100`: returns recent stock movements.

The API rejects invalid product fields and prevents stock from going below zero.

## Local development

Requirements: Node.js 20 or newer.

```bash
npm install
npm run build
npm start
```

Open `http://localhost:3000`.

For Vite development with the API in a second terminal:

```bash
npm run dev:server
npm run dev
```

Then open `http://localhost:5173`.

Optional local demonstration data can be enabled with:

```text
SEED_DEMO_DATA=true
```

## Railway deployment

The project contains `railway.toml` with:

- Build command: `npm run build`.
- Start command: `npm start`.
- Health check: `/api/health`.
- Restart policy on failure.

Recommended Railway steps:

1. Deploy the GitHub repository `bobo-labs/stock-app`.
2. Add a PostgreSQL service to the same Railway project and environment.
3. In the `stock-app` service’s Variables tab, add:

   ```text
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   ```

4. Redeploy the app service.
5. Check deployment logs for `Bakery Stock listening on port ...`.
6. Generate a public domain under the app service’s Networking settings.

The exact service name must match the database service name. If it is named `Postgres`, use `${{Postgres.DATABASE_URL}}`.

Railway PostgreSQL supplies `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE`. The app uses `DATABASE_URL`.

## Environment variables

- `PORT`: supplied by Railway; defaults to `3000` locally.
- `DATABASE_URL`: PostgreSQL connection string; required for persistent Railway storage.
- `DATA_PATH`: JSON path used only when PostgreSQL is not configured.
- `SEED_DEMO_DATA`: optional local demo-data flag.
- `PGSSLMODE`: optional PostgreSQL SSL override. The app disables SSL automatically for Railway internal hosts and otherwise uses a permissive TLS configuration suitable for hosted connection URLs.

Never commit actual values for `DATABASE_URL`, database passwords, or API keys. Use Railway variables.

## Verification history

The following checks were performed during development:

- `npm run build` passed repeatedly after implementation and localization.
- `npm run check` passed for `server/index.js` and `server/store.js`.
- API health endpoint returned successfully.
- JSON fallback storage was tested.
- Product creation was tested.
- Stock-in adjustment was tested and appeared in movement history.
- Spanish and English dashboard rendering were tested.
- Spanish product form labels, categories, units, and modal close label were tested.
- Desktop layout was tested at approximately 1440px.
- Elo/kiosk layout was tested at 1024×768.
- Phone layouts were tested at 390px and 360px.
- Mobile and kiosk layouts were checked for horizontal overflow.
- Browser console errors and warnings were checked; none were present during final UI verification.

## Known limitations before real bakery rollout

1. There is no staff authentication yet. Add login/access control before exposing the app publicly.
2. There are no user roles or permissions yet.
3. There is no barcode scanner integration.
4. There are no supplier records, purchase orders, recipes, production batches, or cost reports yet.
5. There is no export or reporting feature yet.
6. Product names and user-entered notes are not automatically translated; only the interface, categories, units, and standard system messages are translated.
7. A production PostgreSQL backup policy should be configured in Railway.
8. The Windows 7 Elo machine should be isolated or upgraded before use on the public internet.

## Recommended rollout plan

### Phase 1: pilot

- Connect Railway PostgreSQL.
- Add real bakery products and ingredients.
- Set low-stock thresholds.
- Test with one staff member for a week.
- Keep the existing stock process as a fallback during the pilot.

### Phase 2: safety and control

- Add staff login.
- Add manager/staff roles.
- Add database backups and restore testing.
- Add audit filtering by user and date.

### Phase 3: bakery operations

- Add waste tracking.
- Add production batches.
- Add recipes and ingredient consumption.
- Add supplier and purchase-order tracking.
- Add CSV export and weekly reports.
- Add barcode support if the bakery workflow benefits from it.

## Conversation summary

- The conversation started with the Elo PC model and its approximate capabilities.
- The first request was to brainstorm useful projects before building anything.
- The chosen project was a bakery counter dashboard.
- The workspace was initially empty, so the app was built from scratch.
- The first implementation created a deployable React/Vite + Express + PostgreSQL/JSON application.
- Railway deployment support was added through `railway.toml` and README instructions.
- The interface was designed around the Elo touchscreen, phones, and desktops.
- English/Spanish support was then added, with Spanish as the default language.
- The project was initialized as a Git repository and pushed to `https://github.com/bobo-labs/stock-app` on the `main` branch.
- The user created a Railway PostgreSQL service. The required next step is adding `DATABASE_URL=${{Postgres.DATABASE_URL}}` to the `stock-app` service variables.

## Resume checklist

- [ ] Confirm `DATABASE_URL` reference exists on the Railway `stock-app` service.
- [ ] Redeploy and check logs.
- [ ] Generate the Railway public domain.
- [ ] Add a test product and confirm it survives a restart.
- [ ] Add real bakery inventory.
- [ ] Add authentication before public use.

