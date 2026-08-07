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
    await assert.rejects(
      () => store.deleteItem(product.id),
      (error) => error.status === 409,
    )

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

    const deleted = await store.deleteItem(product.id)
    assert.equal(deleted.id, product.id)
    assert.equal((await store.listItems()).length, 0)
    assert.equal((await store.listSales())[0].items[0].name, 'Test croissant')
    assert.equal((await store.listMovements())[0].itemId, null)
  } finally {
    await store.closeStore()
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  }
})

test('partial and full refunds are idempotent, restore selected stock, and track credit notes', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'bakery-refund-test-'))
  process.env.DATA_PATH = path.join(temporaryDirectory, 'inventory.json')
  process.env.SEED_DEMO_DATA = 'false'
  const store = await import(`./store.js?refund-test=${Date.now()}`)

  try {
    await store.initializeStore()
    const product = await store.createItem({
      name: 'Refund croissant', category: 'Pastries', unit: 'pieces', quantity: 10,
      lowStockThreshold: 2, sku: 'REFUND-1', expiryDate: null, price: 1500, sellable: true,
    })
    const reserved = await store.createSale([{ itemId: product.id, quantity: 4 }], 'card')
    const paidOrder = {
      id: `POINT-${reserved.id}`, status: 'processed', status_detail: 'accredited',
      external_reference: `sale-${reserved.id}`,
      transactions: { payments: [{ id: `PAY-${reserved.id}`, status: 'processed', status_detail: 'accredited' }] },
    }
    await store.attachPointOrder(reserved.id, paidOrder)
    const paid = await store.updateSaleFromPoint(paidOrder)
    assert.equal((await store.listItems())[0].quantity, 6)

    const preparedPartial = await store.prepareRefund(paid.id, {
      items: [{ lineId: paid.items[0].lineId, quantity: 2 }], reason: 'Customer return', restock: true,
      creditNoteRequired: true, originalDocumentType: '39', originalFolio: '101',
    })
    assert.equal(preparedPartial.full, false)
    assert.equal(preparedPartial.refund.amount, 3000)
    const partialOrder = {
      ...paidOrder, status: 'processed', status_detail: 'partially_refunded',
      transactions: {
        payments: [{ id: `PAY-${reserved.id}`, status: 'processed', status_detail: 'partially_refunded' }],
        refunds: [{ id: 'MP-REFUND-1', amount: '3000', status: 'processed' }],
      },
    }
    assert.equal((await store.updateSaleFromPoint(partialOrder)).status, 'paid')
    const partial = await store.completeRefund(preparedPartial.refund.id, partialOrder)
    assert.equal(partial.status, 'paid')
    assert.equal(partial.refundedTotal, 3000)
    assert.equal(partial.refundableTotal, 3000)
    assert.equal(partial.refunds[0].creditNote.status, 'pending')
    assert.equal((await store.listItems())[0].quantity, 8)

    await store.completeRefund(preparedPartial.refund.id, partialOrder)
    assert.equal((await store.listItems())[0].quantity, 8)
    const withCreditNote = await store.recordCreditNote(paid.id, preparedPartial.refund.id, {
      originalDocumentType: '39', originalFolio: '101', folio: '55', siiTrackId: 'TRACK-55',
    })
    assert.equal(withCreditNote.refunds[0].creditNote.status, 'issued')
    assert.equal(withCreditNote.refunds[0].creditNote.folio, '55')

    const preparedFull = await store.prepareRefund(paid.id, {
      items: [{ lineId: paid.items[0].lineId, quantity: 2 }], reason: '', restock: false,
      creditNoteRequired: false, originalDocumentType: '', originalFolio: '',
    })
    assert.equal(preparedFull.full, true)
    const full = await store.completeRefund(preparedFull.refund.id, {
      ...paidOrder, status: 'refunded', status_detail: 'refunded',
      transactions: { payments: paidOrder.transactions.payments, refunds: [{ id: 'MP-REFUND-2', amount: '3000', status: 'processed' }] },
    })
    assert.equal(full.status, 'refunded')
    assert.equal(full.refundedTotal, 6000)
    assert.equal((await store.listItems())[0].quantity, 8)
    await assert.rejects(
      () => store.prepareRefund(paid.id, {
        items: [{ lineId: paid.items[0].lineId, quantity: 1 }], reason: '', restock: true,
        creditNoteRequired: false, originalDocumentType: '', originalFolio: '',
      }),
      (error) => error.status === 409,
    )
  } finally {
    await store.closeStore()
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  }
})

test('external Point refunds reconcile once and require an explicit inventory decision', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'bakery-point-reconcile-test-'))
  process.env.DATA_PATH = path.join(temporaryDirectory, 'inventory.json')
  process.env.SEED_DEMO_DATA = 'false'
  const store = await import(`./store.js?point-reconcile=${Date.now()}`)

  try {
    await store.initializeStore()
    const product = await store.createItem({
      name: 'Point refund pastry', category: 'Pastries', unit: 'pieces', quantity: 10,
      lowStockThreshold: 2, sku: 'POINT-REFUND-1', expiryDate: null, price: 500, sellable: true,
    })
    const reserved = await store.createSale([{ itemId: product.id, quantity: 2 }], 'card')
    const paidOrder = {
      id: 'POINT-ORDER-EXTERNAL-1', external_reference: reserved.mpExternalReference,
      status: 'processed', status_detail: 'accredited',
      transactions: { payments: [{ id: 'POINT-PAYMENT-1', reference_id: '172570565606', status: 'processed', status_detail: 'accredited' }] },
    }
    await store.attachPointOrder(reserved.id, paidOrder)
    await store.updateSaleFromPoint(paidOrder)
    await store.updateSalePaymentDetails(reserved.id, {
      id: 172570565606, authorization_code: '253893', payment_method_id: 'master', payment_type_id: 'prepaid_card',
      card: { last_four_digits: '1249' }, fee_details: [{ amount: 21 }],
      transaction_details: { net_received_amount: 979 }, additional_info: { tax_setting: 'CHARGE_TAXABLE_19' },
    })

    const refundedOrder = {
      ...paidOrder, status: 'refunded', status_detail: 'refunded',
      transactions: {
        payments: paidOrder.transactions.payments,
        refunds: [{ id: 'POINT-REFUND-EXTERNAL-1', reference_id: '3166415073', amount: '1000', status: 'processed' }],
      },
    }
    const reconciled = await store.updateSaleFromPoint(refundedOrder)
    assert.equal(reconciled.status, 'refunded')
    assert.equal(reconciled.refundedTotal, 1000)
    assert.equal(reconciled.refunds.length, 1)
    assert.equal(reconciled.refunds[0].source, 'point_terminal')
    assert.equal(reconciled.refunds[0].inventoryReviewStatus, 'pending')
    assert.equal(reconciled.refunds[0].items[0].quantity, 2)
    assert.equal(reconciled.mpCardLastFour, '1249')
    assert.equal(reconciled.mpFeeAmount, 21)
    assert.equal(reconciled.mpTaxSetting, 'CHARGE_TAXABLE_19')
    assert.equal((await store.listItems())[0].quantity, 8)

    assert.equal((await store.updateSaleFromPoint(refundedOrder)).refunds.length, 1)
    const resolved = await store.resolveRefundInventoryReview(reserved.id, reconciled.refunds[0].id, true)
    assert.equal(resolved.refunds[0].inventoryReviewStatus, 'resolved')
    assert.equal((await store.listItems())[0].quantity, 10)
    await store.resolveRefundInventoryReview(reserved.id, reconciled.refunds[0].id, true)
    assert.equal((await store.listItems())[0].quantity, 10)
  } finally {
    await store.closeStore()
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  }
})

test('Mercado Pago webhook signatures use the documented manifest', async () => {
  const webhookSecret = 'webhook-test-secret'
  process.env.MERCADOPAGO_WEBHOOK_SECRET = `${webhookSecret}\n`
  process.env.MERCADOPAGO_MOCK = 'false'
  const point = await import(`./mercadopago.js?test=${Date.now()}`)
  const dataId = 'ORDER-123'
  const requestId = 'request-456'
  const timestamp = '1750000000'
  const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`
  const digest = crypto.createHmac('sha256', webhookSecret).update(manifest).digest('hex')

  assert.equal(point.validatePointWebhook({
    signature: `v2=ignored, v1=${digest}, ts=${timestamp}`,
    requestId,
    dataId,
  }), true)
  assert.equal(point.validatePointWebhook({
    signature: `ts=${timestamp},v1=${digest.replace(/^./, digest[0] === '0' ? '1' : '0')}`,
    requestId,
    dataId,
  }), false)
})
