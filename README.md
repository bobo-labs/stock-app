# Bakery POS

A responsive, touch-friendly bakery inventory and point-of-sale application. Spanish is the default language and English is available from the `ES / EN` control.

## Features

- Add and edit products, prices, sale availability, low-stock thresholds, SKUs, and expiry dates.
- Permanently remove discontinued products while retaining historical sales and activity.
- Record stock in, stock out, count corrections, and a complete movement trail.
- Build a cart from sellable products currently in stock.
- Record cash sales immediately.
- Send card sales to a Mercado Pago Point Smart 2 terminal.
- Keep sales, line-item price snapshots, payment state, and inventory changes in PostgreSQL.
- Restore reserved inventory exactly once when a card order fails, expires, or is cancelled.
- View recent sales and resume a pending terminal payment.
- Refund approved cash or Point sales in full or by selected line items.
- Optionally return refunded items to stock without duplicating inventory movements.
- Track pending and manually issued credit notes separately from the financial refund.
- Review revenue, payment mix, hourly demand, best sellers, and daily cash reconciliation.
- Export a lightweight, self-contained daily HTML report.
- Switch between a soft pastel light theme and a gray dark theme.
- Optional staff PIN protection with an HTTP-only session cookie.
- Responsive layouts for phones, desktops, and the 1024×768 Elo touchscreen.

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm install
npm run build
npm start
```

Open `http://localhost:3000`. Without `DATABASE_URL`, data is stored in `data/inventory.json`.

For a local Point simulation, set:

```text
SEED_DEMO_DATA=true
MERCADOPAGO_MOCK=true
```

The mock terminal approves a card sale after a short delay. Never set `MERCADOPAGO_MOCK=true` in production.

## Deploy to Railway

1. Deploy this GitHub repository as a Railway service.
2. Add PostgreSQL to the same Railway project.
3. In the app service, add `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
4. Add the security and Mercado Pago variables listed below.
5. Redeploy the app and generate a public domain.
6. Open `/api/health`; a healthy deployment returns `{ "ok": true }`.

Database tables and non-destructive schema additions are created automatically on startup.

To replace a connected PostgreSQL database with the generated one-week presentation dataset, run this only from an environment that supplies the intended `DATABASE_URL`:

```bash
npm run seed:week:postgres -- --yes --replace-production-demo
```

The command first copies all current application tables into timestamped tables under the `bakery_demo_backups` schema. It then loads products, sales, line items, inventory movements, and seven daily cash closures in one transaction. If generation, insertion, or verification fails, PostgreSQL rolls the replacement back.

## Point Smart 2 setup

This integration uses Mercado Pago's current Orders API for Point (`POST /v1/orders`), not the older payment-intents integration.

1. Create an application under **Your integrations** in Mercado Pago.
2. Link the Point Smart 2 to the same Mercado Pago account.
3. Create or select the physical store and point of sale.
4. Find the terminal ID using Mercado Pago's terminal list and associate the terminal with that point of sale.
5. Change the terminal operating mode to `PDV`, restart the terminal, and verify the pairing mode on the device.
6. Add the production Access Token and complete terminal ID to Railway.
7. In Mercado Pago Webhooks, set the production URL to:

   ```text
   https://YOUR-RAILWAY-DOMAIN/api/mercadopago/webhook
   ```

8. Select the **Order (Mercado Pago)** event and add the generated secret to Railway.
9. Redeploy, open **Ventas**, and tap the Point status control to verify that the terminal reports `PDV`.

Official references:

- [Mercado Pago Point overview](https://www.mercadopago.cl/developers/en/docs/mp-point/overview)
- [Configure the terminal](https://www.mercadopago.cl/developers/en/docs/mp-point/configure-terminal)
- [Integrate payment processing](https://www.mercadopago.cl/developers/en/docs/mp-point/payment-processing)
- [Configure Point order notifications](https://www.mercadopago.cl/developers/en/docs/mp-point/notifications)
- [Point integration testing](https://www.mercadopago.cl/developers/en/docs/mp-point/integration-test)

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port; Railway supplies this automatically. |
| `DATABASE_URL` | PostgreSQL connection string. |
| `DATA_PATH` | JSON storage path when PostgreSQL is not configured. |
| `SEED_DEMO_DATA` | Set to `true` only for a new local demo database. |
| `STAFF_PIN` | Bakery staff access code. Required before live Point payments are enabled. |
| `SESSION_SECRET` | Long random value used to sign sessions. Required before live Point payments are enabled. |
| `MERCADOPAGO_ACCESS_TOKEN` | Private production or test Access Token. Server-side only. |
| `MERCADOPAGO_POINT_TERMINAL_ID` | Full ID returned by Mercado Pago's terminal list. |
| `MERCADOPAGO_WEBHOOK_SECRET` | Secret generated by the Mercado Pago Webhooks configuration. |
| `MERCADOPAGO_MOCK` | Local-only Point simulator when set to `true`. |
| `MERCADOPAGO_API_BASE` | Optional API base override for controlled testing. |
| `POINT_PILOT_RECEIPT_ENABLED` | Set to `true` to enable the non-tax pilot receipt after an approved Point card sale. Disabled by default. |
| `POINT_PILOT_BUSINESS_NAME` | Business name shown on the pilot receipt. Defaults to `Atelier del Puerto`. |
| `POINT_PILOT_BUSINESS_RUT` | Demonstration RUT text shown on the pilot receipt. Do not present it as tax data until verified. |
| `POINT_PILOT_BUSINESS_ADDRESS` | Address shown on the pilot receipt. |
| `POINT_PILOT_BUSINESS_CITY` | City/region shown on the pilot receipt. |
| `PGSSLMODE` | Optional PostgreSQL SSL override. |

Never put Access Tokens, database passwords, PINs, or webhook secrets in GitHub. Store them as Railway variables.

### Pilot Point receipt

The optional pilot receipt is a demonstration print generated from Bakery POS's immutable sale lines after Mercado Pago confirms a card payment. It uses Mercado Pago's native `custom` Point print format (text plus supported formatting tags), and is explicitly labelled **not tax-valid**. It does not create, replace, or simulate an SII DTE, CAF, folio, TED, or electronic signature. The native format deliberately omits the logo because Point only accepts a logo as a separate PNG/JPEG image print. Keep `POINT_PILOT_RECEIPT_ENABLED` unset in normal production until a supervised physical pilot is intentionally enabled.

Printing is idempotent per sale. A webhook and browser poll can confirm the same payment concurrently without creating duplicate prints. Bakery POS records `sent` when Mercado Pago accepts the action and then checks the action until Point reports `processed`; failed, canceled, or expired prints are recorded on the sale and can be retried from its details. The payment order keeps `print_on_terminal: no_ticket`, so enabling the pilot prints one customized business copy instead of both the standard seller ticket and the pilot receipt.

## Payment and inventory behavior

Cash sales are committed in one database transaction. Card sales reserve inventory before sending the order to Point. The browser polls only while the checkout is open, and the webhook remains the authoritative asynchronous update path.

Point order status mapping:

| Mercado Pago order | Local sale | Inventory |
| --- | --- | --- |
| `created`, `at_terminal`, `action_required` | Pending | Remains reserved |
| `processed` + `accredited` | Paid | Reservation becomes the sale deduction |
| `failed`, `canceled`, `expired` | Final failure | Restored once |
| `processed` + `partially_refunded` | Paid with partial refund | Returned only when selected in the refund |
| `refunded` | Refunded | Returned only when selected in the refund |

A financial refund does not prove that physical products were returned or that a tax document was corrected. The refund flow therefore keeps stock restoration optional and tracks the SII credit note as a separate manual state until an automatic tax integration exists.

Planning and tax research:

- [Product roadmap](ROADMAP.md)
- [SII architecture summary](SII_DTE_RESEARCH.md)
- [Detailed SII integration analysis](integraci%C3%B3n%20SII.md)

## Commands

```bash
npm run check
npm test
npm run build
npm run seed:week -- --yes
npm start
```

`seed:week` only replaces the local JSON demo. The PostgreSQL command is deliberately separate and requires the two explicit confirmation flags shown in the Railway section.

## Production note

Keep staff authentication enabled on any public Railway deployment. This release provides one shared staff PIN; individual accounts, roles, approval limits, automatic tax issuance, and searchable long-term sales history remain necessary before a larger rollout.
