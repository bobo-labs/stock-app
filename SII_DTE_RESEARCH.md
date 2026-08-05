# SII Electronic Receipt and DTE Research

Updated: 2026-08-05

## Executive decision

An in-house integration is technically possible, but it is not a simple REST call added to the current Express server. The SII requires valid DTE XML, CAF folios, electronic signatures, a taxpayer digital certificate, certification tests, submission, status reconciliation, and daily reporting.

The correct path is to build a separate DTE boundary behind the POS. The POS records the sale once; a durable worker issues and reconciles the tax document. A failed SII response must never charge the customer twice or silently consume another folio.

## What SII provides

For electronic receipts, SII publishes REST services for:

- receipt-specific seed and token authentication;
- electronic receipt upload;
- upload status queries;
- individual receipt queries.

The API description is published as OpenAPI/Swagger at `https://www4c.sii.cl/bolcoreinternetui/api/`. The payload is still the signed SII XML format; REST does not replace CAF, TED, XMLDSIG, folio control, or certification.

SII limits an electronic-receipt submission to 500 receipts. Receipt services use a token distinct from the invoice SOAP services. A production daily RVD/RCF is no longer required for operations since August 2022, although the current certification guide can still request an RCF as part of its test set.

Official references:

- [SII electronic receipt API instruction](https://www.sii.cl/factura_electronica/factura_mercado/Instructivo_Emision_Boleta_Elect.pdf)
- [SII certification guide for electronic receipts](https://www.sii.cl/servicios_online/1039-guia_emitir_boleta_servicio-1184.html)
- [SII FAQ: production RVD obligation ended in August 2022](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7679.htm)
- [SII Resolution 53/2022](https://www.sii.cl/normativa_legislacion/resoluciones/2022/reso53.pdf)
- [SII technical DTE documentation](https://www.sii.cl/factura_electronica/tecnica.htm)
- [SII technical integration index](https://www.sii.cl/factura_electronica/factura_mercado/instructivo.htm)
- [SII certification process for own or market systems](https://www.sii.cl/factura_electronica/factura_mercado/proceso_certificacion.htm)
- [SII answer: an electronic receipt is annulled with an electronic credit note](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_5352.htm)

## Certification and required inputs

Before production issuance, the taxpayer's legal representative must complete the SII process. At minimum we need:

1. Active taxpayer identity and confirmation of its current electronic-invoicing status.
2. A valid personal digital certificate for an authorized user.
3. Access to SII's certification environment and the assigned test set.
4. CAF files for every DTE type to be certified.
5. Successful XML receipt submissions and any RCF artifact requested by the assigned certification test set.
6. SII review, declaration of compliance, and production authorization.

The current app cannot honestly label a credit note as "issued by SII" until those requirements exist. It now tracks a pending note and can record one that was issued manually in SII; automatic issuance remains disabled by design.

## Costs

SII documents do not describe a per-request or per-DTE API fee for direct integration. "Own development" therefore avoids a billing provider's per-document plan, but it is not cost-free.

| Cost | Type | Practical impact |
| --- | --- | --- |
| SII API and certification portal | No per-document fee documented | Direct access is part of the taxpayer process. |
| Digital certificate | Paid, recurring | Purchased from a certificate provider; price and validity depend on that provider. |
| Engineering and certification | High one-time cost | XML, signatures, CAF/TED, queues, status handling, print output, and certification cases. |
| Hosting and secure key storage | Recurring | Isolated worker, encrypted secrets, backups, monitoring, and logs. |
| Regulatory maintenance | Recurring | SII schemas, resolutions, validation rules, and TLS requirements change over time. |
| Support and incident handling | Recurring | Rejected DTEs, unavailable SII services, exhausted folios, and reconciliation need procedures. |

Engineering estimate, not an SII promise: a production-quality first scope covering types 39/41, type 61, any RCF fixture required for certification, certificate handling, status reconciliation, and certification is roughly 10-16 focused engineering weeks for an experienced developer, plus external review time and operational hardening. A quick XML generator is much smaller; a reliable tax subsystem is not.

For one bakery, a certified provider may initially be cheaper in total risk. For a POS intended to serve many Chilean businesses, owning the DTE layer can become strategically valuable, but only after tenant isolation and credential security are in place.

## Open-source implementation review

### LibreDTE

[LibreDTE Core](https://github.com/LibreDTE/libredte-lib-core) is the most substantial implementation reviewed: PHP, extensive DTE scope, tests, signing, and SII integration. It is useful as a behavior and architecture reference.

It is licensed under AGPL-3.0 and its repository explicitly states that software using it must publish its source under AGPL. That conflicts with a future proprietary POS unless we deliberately adopt that licensing model. We should not copy or embed it casually.

### sii-chile-cert

[sii-chile-cert](https://github.com/dbenaventep/sii-chile-cert) is an MIT-licensed Python guide and test-oriented implementation covering certification experience, DTE types including 39 and 61, examples, schemas, and known library patches. It is useful for certification fixtures and independent validation, but its small history means it should not become the production tax engine without a security and correctness audit.

### Recommendation

Use the official SII schemas and instructions as the source of truth. Use open-source projects to build test vectors and understand edge cases. Implement our production boundary with explicit tests and keep the option to replace the internal engine without changing the POS.

## Proposed architecture

```text
POS sale/refund
    |
    v
tax document outbox (PostgreSQL, idempotent)
    |
    v
isolated DTE worker
    |- folio allocator and CAF validation
    |- XML/TED generation and XMLDSIG signature
    |- SII seed/token authentication
    |- submit and poll status
    `- printable/email representation
    |
    v
accepted / rejected / retry / manual review
```

Required data boundaries:

- `issuer_configs`: taxpayer, environment, branches, emission model, encrypted certificate reference.
- `folio_ranges`: DTE type, CAF fingerprint, authorized range, next folio, consumed/void state.
- `tax_documents`: sale/refund relation, DTE type, folio, signed XML hash, track ID, SII status.
- `tax_document_events`: append-only submission and status history.
- `tax_outbox`: retries, idempotency key, next attempt, terminal/manual-review state.

The certificate password and private key must never be sent to the browser, committed to Git, or stored as plain application data. Railway variables alone are not sufficient long-term for multiple companies; each tenant needs encrypted, access-controlled key material and rotation procedures.

## Required product decision

Before implementation, confirm whether Atelier del Puerto uses the payment voucher as its electronic receipt under its SII configuration. Mercado Pago reimbursement and SII correction are separate operations:

- Mercado Pago returns money to the original payment method.
- SII type 61 corrects or annuls the accepted tax document.
- Inventory restoration is an independent business decision.

The POS must coordinate all three without treating any one of them as proof that the others succeeded.

The expanded regulatory, security, migration, and market analysis lives in [integracion SII](integraci%C3%B3n%20SII.md).
