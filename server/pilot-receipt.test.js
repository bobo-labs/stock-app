import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { pilotReceiptConfiguration, renderPilotReceipt } from './pilot-receipt.js'

test('pilot receipt renders a Point-compatible 8-bit PNG with the sale snapshot', async () => {
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
    const content = await renderPilotReceipt(sale)
    const buffer = Buffer.from(content, 'base64')
    const metadata = await sharp(buffer).metadata()
    assert.equal(pilotReceiptConfiguration().enabled, true)
    assert.equal(metadata.format, 'png')
    assert.equal(metadata.width, 384)
    assert.ok(metadata.height >= 546)
    assert.notEqual(metadata.isPalette, true)
    assert.equal(metadata.bitsPerSample, 8)
    assert.ok(buffer.length < 1024 * 1024)
  } finally {
    if (previous === undefined) delete process.env.POINT_PILOT_RECEIPT_ENABLED
    else process.env.POINT_PILOT_RECEIPT_ENABLED = previous
  }
})
