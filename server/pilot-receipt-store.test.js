import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('pilot receipt print state prevents duplicate actions and records terminal confirmation', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'bakery-pilot-receipt-'))
  const previousDataPath = process.env.DATA_PATH
  const previousDatabaseUrl = process.env.DATABASE_URL
  try {
    process.env.DATA_PATH = path.join(temporaryDirectory, 'inventory.json')
    delete process.env.DATABASE_URL
    const store = await import(`./store.js?pilot-receipt-state=${Date.now()}`)
    await store.initializeStore()
    const product = await store.createItem({
      name: 'Producto piloto', category: 'Pastelería', unit: 'unidades', quantity: 2,
      lowStockThreshold: 0, sku: '', expiryDate: null, price: 500, sellable: true,
    })
    const sale = await store.createSale([{ itemId: product.id, quantity: 1 }], 'cash')
    const data = JSON.parse(await fs.readFile(process.env.DATA_PATH, 'utf8'))
    const storedSale = data.sales.find((entry) => entry.id === sale.id)
    storedSale.paymentMethod = 'card'
    storedSale.status = 'paid'
    storedSale.paidAt = new Date().toISOString()
    await fs.writeFile(process.env.DATA_PATH, JSON.stringify(data, null, 2))

    assert.ok(await store.claimPilotReceiptPrint(sale.id))
    assert.equal(await store.claimPilotReceiptPrint(sale.id), null)
    let updated = await store.completePilotReceiptPrint(sale.id, { id: 'ACTION-1', status: 'created' })
    assert.equal(updated.pilotReceiptStatus, 'sent')
    assert.equal(await store.claimPilotReceiptPrint(sale.id, true), null)
    updated = await store.completePilotReceiptPrint(sale.id, { id: 'ACTION-1', status: 'processed' })
    assert.equal(updated.pilotReceiptStatus, 'printed')
    assert.ok(updated.pilotReceiptPrintedAt)

    assert.ok(await store.claimPilotReceiptPrint(sale.id, true, true))
    assert.equal(await store.claimPilotReceiptPrint(sale.id, true, true), null)
    updated = await store.completePilotReceiptPrint(sale.id, { id: 'ACTION-2', status: 'created' })
    assert.equal(updated.pilotReceiptStatus, 'sent')
    assert.equal(updated.pilotReceiptActionId, 'ACTION-2')
  } finally {
    if (previousDataPath === undefined) delete process.env.DATA_PATH
    else process.env.DATA_PATH = previousDataPath
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  }
})
