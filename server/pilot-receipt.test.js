import assert from 'node:assert/strict'
import test from 'node:test'
import { loadPilotReceiptLogo, pilotReceiptConfiguration, renderPilotReceipt } from './pilot-receipt.js'

test('pilot receipt renders Point custom-print content with the sale snapshot', async () => {
  const previous = process.env.POINT_PILOT_RECEIPT_ENABLED
  process.env.POINT_PILOT_RECEIPT_ENABLED = 'true'
  try {
    const sale = {
      id: 'sale-uuid-1', shortId: 'SALE0001', paymentMethod: 'card', status: 'paid', total: 4850,
      paidAt: '2026-08-10T15:30:00.000Z', mpOperationId: '171691716597', mpAuthorizationCode: '264890',
      items: [
        { name: 'Croissant de mantequilla', quantity: 2, unitPrice: 1500, lineTotal: 3000 },
        { name: 'Pie de limón', quantity: 1, unitPrice: 1850, lineTotal: 1850 },
      ],
    }
    const content = await renderPilotReceipt(sale, { logoIncluded: true })
    assert.equal(pilotReceiptConfiguration().enabled, true)
    assert.match(content, /^\{center\}/)
    assert.doesNotMatch(content, /\{w\}\{b\}ATELIER DEL PUERTO\{\/b\}\{\/w\}/)
    assert.match(content, /CROISSANT DE MANTEQUILLA/)
    assert.match(content, /2 x \$1\.500 = \$3\.000/)
    assert.match(content, /TOTAL \$4\.850/)
    assert.match(content, /Operacion MP: 171691716597/)
    assert.match(content, /Estado: VENTA PAGADA/)
    assert.match(content, /\{w\}\{b\}VENTA PAGADA\{\/b\}\{\/w\}/)
    assert.match(content, /No es boleta ni DTE/)
    assert.ok(content.length >= 100)
    assert.ok(content.length <= 4096)
    assert.doesNotMatch(content, /^iVBOR/)
  } finally {
    if (previous === undefined) delete process.env.POINT_PILOT_RECEIPT_ENABLED
    else process.env.POINT_PILOT_RECEIPT_ENABLED = previous
  }
})

test('pilot receipt reflects partial and full refunds', async () => {
  const baseSale = {
    shortId: 'SALE0003', paymentMethod: 'card', total: 1000,
    paidAt: '2026-08-10T15:30:00.000Z', items: [
      { name: 'Producto de prueba', quantity: 1, unitPrice: 1000, lineTotal: 1000 },
    ],
  }
  const partial = await renderPilotReceipt({ ...baseSale, status: 'paid', refundedTotal: 250 })
  assert.match(partial, /Estado: REEMBOLSO PARCIAL/)
  assert.match(partial, /TOTAL ORIGINAL \$1\.000/)
  assert.match(partial, /REEMBOLSADO \$250/)
  assert.match(partial, /SALDO \$750/)

  const full = await renderPilotReceipt({ ...baseSale, status: 'refunded', refundedTotal: 1000 })
  assert.match(full, /Estado: VENTA REEMBOLSADA/)
  assert.match(full, /REEMBOLSADO \$1\.000/)
  assert.match(full, /SALDO \$0/)
  assert.doesNotMatch(full, /GRACIAS POR SU COMPRA/)
})

test('pilot receipt logo is a compact PNG ready for a separate Point image action', async () => {
  const previous = process.env.POINT_PILOT_LOGO_ENABLED
  delete process.env.POINT_PILOT_LOGO_ENABLED
  try {
    const logo = await loadPilotReceiptLogo()
    const image = Buffer.from(logo, 'base64')
    assert.ok(image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    assert.ok(image.length < 1024 * 1024)
  } finally {
    if (previous === undefined) delete process.env.POINT_PILOT_LOGO_ENABLED
    else process.env.POINT_PILOT_LOGO_ENABLED = previous
  }
})

test('pilot receipt sanitizes print tags and stays within Mercado Pago custom-content limits', async () => {
  const sale = {
    shortId: 'SALE{w}0002',
    paymentMethod: 'card',
    status: 'paid',
    total: 40000,
    paidAt: '2026-08-10T15:30:00.000Z',
    items: Array.from({ length: 80 }, (_, index) => ({
      name: `Producto ${index + 1} {qr}contenido no confiable{/qr} con un nombre muy largo para envolver`,
      quantity: 1,
      unitPrice: 500,
      lineTotal: 500,
    })),
  }
  const content = await renderPilotReceipt(sale)
  assert.ok(content.length <= 4096)
  assert.doesNotMatch(content, /\{qr\}/)
  assert.match(content, /productos adicionales/)
})
