# Mercado Pago Point quality evidence

This document records how Bakery POS implements the two quality controls that
cannot be inferred reliably from a payment amount alone. It intentionally
contains no credentials or webhook secret.

## Centralized credentials

- `MERCADOPAGO_ACCESS_TOKEN` is stored only as a server environment variable in
  Railway.
- The browser calls Bakery POS endpoints under `/api`; it never calls Mercado
  Pago directly and never receives the Access Token.
- The server sends every Mercado Pago API request with
  `Authorization: Bearer <server token>`.
- API responses expose only non-secret readiness booleans and architecture
  metadata. They never return the token or webhook secret.
- Live Point operations are protected by the staff session before the backend
  can create, cancel, or refund an order.

Official reference: [Mercado Pago Point credentials](https://www.mercadopago.cl/developers/es/docs/mp-point/resources/credentials).

## Webhook notifications

- Application: Bakery POS (`263652474269905`).
- Production endpoint:
  `https://stock-app-production-c80c.up.railway.app/api/mercadopago/webhook`.
- Topic: `order` / **Order (Mercado Pago)**.
- The endpoint is public over HTTPS, validates `x-signature`, immediately
  acknowledges accepted notifications with HTTP 200, and then obtains the
  authoritative resource through `GET /v1/orders/{id}`.
- Processing is idempotent in the local sale store; duplicate notifications do
  not deduct inventory twice.
- On 2026-08-15 the Mercado Pago notifications diagnostic reported 15 of 15
  deliveries successful, all HTTP 200, with an average response time of about
  62 ms.
- The production and sandbox callback URLs were saved again on 2026-08-15 for
  application `263652474269905`, subscribed to the `order` topic.

The current Point Orders API configures the callback at application level. Its
`POST /v1/orders` request schema does not include the legacy
`notification_url` payment field, so Bakery POS deliberately does not send an
unsupported field in the order body.

If the quality panel continues to request a per-payment `notification_url`,
that message refers to the legacy Payment Intent model. Bakery POS uses the
current `POST /v1/orders` Point contract: the documented request schema has no
`notification_url`, and notifications are configured at application level.
The webhook-delivery history above is the operational proof that the callback
is active.

Official references:

- [Configure Point notifications](https://www.mercadopago.cl/developers/es/docs/mp-point/notifications)
- [Create a Point order](https://www.mercadopago.cl/developers/es/reference/in-person-payments/point/orders/create-order/post)

## Automated checks

`server/mercadopago.test.js` verifies that:

- every outbound Mercado Pago request uses the server-side Bearer token;
- public configuration and management payloads contain neither the Access
  Token nor the webhook secret;
- order creation keeps a unique `external_reference` and does not add the
  unsupported `notification_url` field;
- the webhook signature manifest follows Mercado Pago's documented format.

Run `npm test`, `npm run check`, and `npm run build` before deployment.
