# Astryx migration

## Current stage

The Bakery POS is adopting Astryx incrementally. The first production-ready
surface is the permanent product deletion confirmation.

- Astryx packages are pinned to `0.2.0` while the project is in beta.
- The Bakery dialog uses Astryx Neutral with scoped cocoa, cream, and gray
  light/dark tokens. It never owns or mutates the app's `<html data-theme>`.
- Astryx receives the active Bakery POS language and theme.
- The destructive confirmation uses Astryx `AlertDialog` semantics, safe
  initial focus, Escape dismissal, and full-width mobile actions.
- Astryx does not own or mutate inventory, sales, metrics, Mercado Pago, API,
  or database state. Those workflows remain in the Bakery POS components.

## Performance boundary

Astryx is intentionally lazy-loaded when the cashier first opens the permanent
delete confirmation. Its global stylesheet is not part of the initial app
bundle.

| Asset | Migration baseline | Current release initial load |
| --- | ---: | ---: |
| Main JavaScript | 280.53 kB / 85.40 kB gzip | 297.39 kB / 89.84 kB gzip |
| Main CSS | 59.26 kB / 11.89 kB gzip | 64.87 kB / 12.98 kB gzip |

The on-demand Astryx delete workflow remains approximately 71.4 kB gzip on
first use and is then browser-cacheable. The current initial-load delta also
includes the separate returns and credit-note interface added in this release;
it is not an Astryx-only comparison.

## Verification completed

- Existing server tests: 8 passing
- Production Vite build: passing
- Spanish and English labels
- Light and gray dark themes
- Elo viewport: 1024 x 768
- Mobile viewport: 390 x 844
- Long mobile action labels stack without clipping
- Escape closes only the confirmation, keeps the product editor open, and
  restores focus to the delete trigger
- Opening and closing the confirmation preserves the selected app theme in
  both directions (`dark -> dark -> dark` and `light -> light -> light`)
- No browser console warnings or errors during the checked flow

No product was deleted during browser verification.

## Recommended next stage

Continue with workflow components that benefit most from focus management and
validation while keeping them in an on-demand Astryx chunk:

1. Stock adjustment dialog
2. Add/edit product dialog and form controls
3. Daily cash-close dialog
4. Checkout status and retry confirmations

Do not migrate the sales grid, cart, charts, or application shell until the
workflow migration has been used at the counter and its bundle and touch
performance have been measured on the physical Elo computer.
