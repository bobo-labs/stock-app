import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('cash and card sales update stock exactly once', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'bakery-pos-test-'))
  process.env.DATA_PATH = path.join(temporaryDirectory, 'inventory.json')
  process.env.SEED_DEMO_DATA = 'false'
  const store = await import(`./store.js?test=${Date.now()}`)

  try {
    await store.initializeStore()
    const product = await store.createItem({
      name: 'Test croissant', category: 'Pastries', unit: 'pieces', quantity: 10,
      lowStockThreshold: 2, sku: 'TEST-1', expiryDate: null, price: 1500, sellable: true,
    })

    const cash = await store.createSale([{ itemId: product.id, quantity: 2 }], 'cash')
    assert.equal(cash.status, 'paid')
    assert.equal(cash.total, 3000)
    assert.equal((await store.listItems())[0].quantity, 8)

    const card = await store.createSale([{ itemId: product.id, quantity: 3 }], 'card')
    assert.equal(card.status, 'pending')
    assert.equal((await store.listItems())[0].quantity, 5)

    const order = {
      id: `MOCK-${card.id}`, status: 'canceled', status_detail: 'canceled',
      external_reference: `sale-${card.id}`,
      transactions: { payments: [{ id: `PAY-${card.id}`, status: 'canceled' }] },
    }
    await store.attachPointOrder(card.id, order)
    const cancelled = await store.updateSaleFromPoint(order)
    assert.equal(cancelled.status, 'cancelled')
    assert.equal((await store.listItems())[0].quantity, 8)

    await store.updateSaleFromPoint(order)
    assert.equal((await store.listItems())[0].quantity, 8)
    assert.equal((await store.listSales()).length, 2)
  } finally {
    await store.closeStore()
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  }
})

test('Mercado Pago webhook signatures use the documented manifest', async () => {
  process.env.MERCADOPAGO_WEBHOOK_SECRET = 'webhook-test-secret'
  process.env.MERCADOPAGO_MOCK = 'false'
  const point = await import(`./mercadopago.js?test=${Date.now()}`)
  const dataId = 'ORDER-123'
  const requestId = 'request-456'
  const timestamp = '1750000000'
  const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`
  const digest = crypto.createHmac('sha256', process.env.MERCADOPAGO_WEBHOOK_SECRET).update(manifest).digest('hex')

  assert.equal(point.validatePointWebhook({
    signature: `ts=${timestamp},v1=${digest}`,
    requestId,
    dataId,
  }), true)
  assert.equal(point.validatePointWebhook({
    signature: `ts=${timestamp},v1=${digest.replace(/^./, digest[0] === '0' ? '1' : '0')}`,
    requestId,
    dataId,
  }), false)
})
