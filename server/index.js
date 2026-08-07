import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import compression from 'compression'
import express from 'express'
import { authStatus, login, logout, pointAccessIsProtected, requireAuth } from './auth.js'
import {
  cancelPointOrder, createPointOrder, getConfiguredTerminal, getPointOrder, getPointPayment,
  pointConfiguration, refundPointOrder, validatePointWebhook,
} from './mercadopago.js'
import {
  adjustItem, attachPointOrder, closeStore, completeRefund, createItem, createSale, deleteItem, failRefund, getSale,
  getSaleByPointOrder, getSalesMetrics, initializeStore, listItems, listMovements, listSales,
  markCardSaleFailed, prepareRefund, recordCreditNote, resolveRefundInventoryReview, saveCashClosure,
  updateItem, updateSaleFromPoint, updateSalePaymentDetails,
} from './store.js'
import { createDailyReport } from './report.js'

const app = express()
const port = Number(process.env.PORT || 3000)
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(compression())
app.use(express.json({ limit: '200kb' }))

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 })
}

function cleanItem(body, isUpdate = false) {
  const item = {
    name: String(body.name || '').trim(),
    category: String(body.category || '').trim(),
    unit: String(body.unit || '').trim(),
    lowStockThreshold: Number(body.lowStockThreshold ?? 0),
    sku: String(body.sku || '').trim(),
    expiryDate: body.expiryDate || null,
    price: Number(body.price ?? 0),
    sellable: body.sellable === true,
  }
  if (!isUpdate) item.quantity = Number(body.quantity ?? 0)
  if (!item.name || !item.category || !item.unit) throw badRequest('Name, category, and unit are required.')
  if ((!isUpdate && (!Number.isFinite(item.quantity) || item.quantity < 0)) || !Number.isFinite(item.lowStockThreshold) || item.lowStockThreshold < 0) {
    throw badRequest('Quantities must be positive numbers.')
  }
  if (!Number.isInteger(item.price) || item.price < 0) throw badRequest('Price must be a whole Chilean peso amount.')
  if (item.sellable && item.price <= 0) throw badRequest('A product for sale must have a price greater than zero.')
  return item
}

function cleanCart(body) {
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 100) throw badRequest('Add at least one product to the sale.')
  const combined = new Map()
  for (const line of body.items) {
    const itemId = String(line.itemId || '')
    const quantity = Number(line.quantity)
    if (!itemId || !Number.isFinite(quantity) || quantity <= 0 || quantity > 10000) throw badRequest('The cart contains an invalid quantity.')
    combined.set(itemId, (combined.get(itemId) || 0) + quantity)
  }
  return [...combined.entries()].map(([itemId, quantity]) => ({ itemId, quantity }))
}

function cleanRefund(body) {
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 100) throw badRequest('Select at least one product to refund.')
  const items = body.items.map((line) => {
    const lineId = String(line.lineId || '')
    const quantity = Number(line.quantity)
    if (!lineId || !Number.isFinite(quantity) || quantity <= 0 || quantity > 10000) throw badRequest('The refund contains an invalid quantity.')
    return { lineId, quantity }
  })
  const originalDocumentType = String(body.originalDocumentType || '')
  if (originalDocumentType && !['33', '34', '39', '41'].includes(originalDocumentType)) throw badRequest('The original tax document type is invalid.')
  return {
    items,
    reason: String(body.reason || '').trim().slice(0, 300),
    restock: body.restock !== false,
    creditNoteRequired: body.creditNoteRequired === true,
    originalDocumentType,
    originalFolio: String(body.originalFolio || '').trim().slice(0, 30),
  }
}

function cleanCreditNote(body) {
  const input = {
    originalDocumentType: String(body.originalDocumentType || ''),
    originalFolio: String(body.originalFolio || '').trim(),
    folio: String(body.folio || '').trim(),
    siiTrackId: String(body.siiTrackId || '').trim().slice(0, 80),
  }
  if (!['33', '34', '39', '41'].includes(input.originalDocumentType)) throw badRequest('Select the original tax document type.')
  if (!/^\d{1,18}$/.test(input.originalFolio) || !/^\d{1,18}$/.test(input.folio)) throw badRequest('Enter valid numeric folios for both tax documents.')
  return input
}

function parseInstant(value, name) {
  const parsed = new Date(String(value || ''))
  if (Number.isNaN(parsed.getTime())) throw badRequest(`${name} must be a valid date.`)
  return parsed
}

function cleanMetricsPeriod(source) {
  const period = {
    from: parseInstant(source.from, 'from'),
    to: parseInstant(source.to, 'to'),
    previousFrom: parseInstant(source.previousFrom, 'previousFrom'),
    previousTo: parseInstant(source.previousTo, 'previousTo'),
    todayFrom: parseInstant(source.todayFrom, 'todayFrom'),
    todayTo: parseInstant(source.todayTo, 'todayTo'),
    businessDate: String(source.businessDate || ''),
  }
  if (period.from >= period.to || period.previousFrom >= period.previousTo || period.todayFrom >= period.todayTo) throw badRequest('The metrics date range is invalid.')
  if (period.to - period.from > 370 * 86400000) throw badRequest('The metrics date range is too large.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period.businessDate)) throw badRequest('businessDate must use YYYY-MM-DD.')
  return period
}

function cleanCashClosure(body) {
  const period = cleanMetricsPeriod(body)
  const input = {
    businessDate: period.businessDate,
    openingCash: Number(body.openingCash ?? 0),
    cashAdjustments: Number(body.cashAdjustments ?? 0),
    countedCash: Number(body.countedCash ?? 0),
    note: String(body.note || '').trim().slice(0, 500),
  }
  if (![input.openingCash, input.cashAdjustments, input.countedCash].every(Number.isInteger)) throw badRequest('Cash amounts must be whole Chilean pesos.')
  if (input.openingCash < 0 || input.countedCash < 0) throw badRequest('Opening and counted cash cannot be negative.')
  if (Math.abs(input.cashAdjustments) > 100000000) throw badRequest('The cash adjustment is too large.')
  return { input, period }
}

function requireProtectedPoint() {
  if (!pointConfiguration().configured) throw Object.assign(new Error('Point Smart 2 is not configured yet.'), { status: 503 })
  if (!pointAccessIsProtected() && !pointConfiguration().mockMode) {
    throw Object.assign(new Error('Set STAFF_PIN and SESSION_SECRET before enabling live Point payments.'), { status: 503 })
  }
}

function elapsedMilliseconds(startedAt) {
  return Math.round((performance.now() - startedAt) * 10) / 10
}

function sendPointTiming(res, requestId, timings) {
  res.setHeader('X-Request-ID', requestId)
  res.setHeader('Server-Timing', Object.entries(timings)
    .map(([name, duration]) => `${name};dur=${duration}`)
    .join(', '))
}

function logPointTiming(requestId, sale, outcome, timings) {
  console.info(JSON.stringify({
    event: 'point_order_timing',
    requestId,
    saleId: sale?.id || null,
    outcome,
    timings,
  }))
}

async function enrichPointPayment(sale, order) {
  const paymentReference = order?.transactions?.payments?.[0]?.reference_id
  if (!sale || !paymentReference) return sale
  try {
    const payment = await getPointPayment(paymentReference)
    return await updateSalePaymentDetails(sale.id, payment) || sale
  } catch (error) {
    console.error('Mercado Pago payment enrichment failed:', error)
    return sale
  }
}

async function reconcilePointSale(sale, knownOrder = null) {
  if (!sale?.mpOrderId && !knownOrder?.id) return sale
  const order = knownOrder || await getPointOrder(sale.mpOrderId, sale)
  const updated = await updateSaleFromPoint(order)
  return enrichPointPayment(updated || sale, order)
}

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.post('/api/mercadopago/webhook', async (req, res, next) => {
  try {
    const dataId = String(req.query['data.id'] || req.body?.data?.id || '').trim()
    const signatureValid = validatePointWebhook({
      signature: req.headers['x-signature'],
      requestId: req.headers['x-request-id'],
      dataId,
    })
    let knownSale = null

    if (!signatureValid) {
      // Some live Point notifications have produced signatures that differ from
      // the dashboard simulator. Never trust that payload: only use a known,
      // high-entropy order id as a hint and fetch the authoritative order below.
      if (!/^ORD[A-Z0-9]{20,}$/i.test(dataId)) return res.status(401).json({ error: 'Invalid webhook signature.' })
      knownSale = await getSaleByPointOrder(dataId)
      if (!knownSale) return res.status(401).json({ error: 'Invalid webhook signature.' })
      console.warn(JSON.stringify({
        event: 'point_webhook_signature_fallback',
        requestId: req.headers['x-request-id'] || null,
        saleId: knownSale.id,
        orderId: dataId,
      }))
    }

    res.status(200).end()
    setImmediate(async () => {
      const startedAt = performance.now()
      try {
        const sale = knownSale || await getSaleByPointOrder(dataId)
        if (!sale && pointConfiguration().mockMode) return
        const order = await getPointOrder(dataId, sale)
        const updatedSale = await reconcilePointSale(sale, order)
        console.info(JSON.stringify({
          event: 'point_webhook_status',
          requestId: req.headers['x-request-id'] || null,
          signatureValid,
          saleId: updatedSale?.id || sale?.id || null,
          from: sale?.mpStatus || null,
          to: updatedSale?.mpStatus || order.status || null,
          status: updatedSale?.status || null,
          ageMs: updatedSale ? Date.now() - new Date(updatedSale.createdAt).getTime() : null,
          totalMs: elapsedMilliseconds(startedAt),
        }))
      } catch (error) {
        console.error('Mercado Pago webhook processing failed:', error)
      }
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/status', (req, res) => res.json(authStatus(req)))
app.post('/api/auth/login', login)
app.post('/api/auth/logout', logout)
app.use('/api', requireAuth)

app.get('/api/items', async (_req, res, next) => {
  try { res.json(await listItems()) } catch (error) { next(error) }
})
app.post('/api/items', async (req, res, next) => {
  try { res.status(201).json(await createItem(cleanItem(req.body))) } catch (error) { next(error) }
})
app.patch('/api/items/:id', async (req, res, next) => {
  try {
    const item = await updateItem(req.params.id, cleanItem(req.body, true))
    if (!item) return res.status(404).json({ error: 'Product not found.' })
    res.json(item)
  } catch (error) { next(error) }
})
app.delete('/api/items/:id', async (req, res, next) => {
  try {
    const item = await deleteItem(req.params.id)
    if (!item) return res.status(404).json({ error: 'Product not found.' })
    res.json(item)
  } catch (error) { next(error) }
})
app.post('/api/items/:id/adjust', async (req, res, next) => {
  try {
    const type = req.body.type
    const quantity = Number(req.body.quantity)
    if (!['stock_in', 'stock_out', 'adjustment'].includes(type)) throw badRequest('Invalid stock action.')
    if (!Number.isFinite(quantity) || quantity < 0 || (type !== 'adjustment' && quantity === 0)) throw badRequest('Enter a valid quantity.')
    const item = await adjustItem(req.params.id, { type, quantity, note: String(req.body.note || '').trim() })
    if (!item) return res.status(404).json({ error: 'Product not found.' })
    res.json(item)
  } catch (error) { next(error) }
})
app.get('/api/movements', async (req, res, next) => {
  try { res.json(await listMovements(Math.min(Number(req.query.limit) || 50, 200))) } catch (error) { next(error) }
})

app.get('/api/metrics', async (req, res, next) => {
  try { res.json(await getSalesMetrics(cleanMetricsPeriod(req.query))) } catch (error) { next(error) }
})
app.post('/api/cash-closures', async (req, res, next) => {
  try {
    const { input, period } = cleanCashClosure(req.body)
    res.json(await saveCashClosure(input, period.todayFrom, period.todayTo))
  } catch (error) { next(error) }
})
app.get('/api/reports/daily', async (req, res, next) => {
  try {
    const period = cleanMetricsPeriod(req.query)
    const language = req.query.language === 'en' ? 'en' : 'es'
    const [metrics, items] = await Promise.all([getSalesMetrics(period), listItems()])
    const report = createDailyReport({ metrics, items, businessDate: period.businessDate, language })
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="bakery-report-${period.businessDate}.html"`,
      'Cache-Control': 'no-store',
    }).send(report)
  } catch (error) { next(error) }
})

app.get('/api/sales', async (req, res, next) => {
  try { res.json(await listSales(Math.min(Number(req.query.limit) || 50, 200))) } catch (error) { next(error) }
})
app.post('/api/sales/cash', async (req, res, next) => {
  try { res.status(201).json(await createSale(cleanCart(req.body), 'cash')) } catch (error) { next(error) }
})
app.post('/api/sales/card', async (req, res, next) => {
  let sale
  const requestId = crypto.randomUUID()
  const requestStartedAt = performance.now()
  const timings = {}
  try {
    requireProtectedPoint()
    const reserveStartedAt = performance.now()
    sale = await createSale(cleanCart(req.body), 'card')
    timings.reserve = elapsedMilliseconds(reserveStartedAt)
    const mercadoPagoStartedAt = performance.now()
    const order = await createPointOrder(sale)
    timings.mercadopago = elapsedMilliseconds(mercadoPagoStartedAt)
    const persistStartedAt = performance.now()
    const attachedSale = await attachPointOrder(sale.id, order, sale)
    timings.persist = elapsedMilliseconds(persistStartedAt)
    timings.total = elapsedMilliseconds(requestStartedAt)
    sendPointTiming(res, requestId, timings)
    logPointTiming(requestId, attachedSale, 'created', timings)
    res.status(201).json({ ...attachedSale, pointTiming: timings, requestId })
  } catch (error) {
    if (sale && !error.uncertain) await markCardSaleFailed(sale.id, error.mercadoPagoCode || 'order_creation_failed').catch(console.error)
    if (sale) error.saleId = sale.id
    timings.total = elapsedMilliseconds(requestStartedAt)
    sendPointTiming(res, requestId, timings)
    logPointTiming(requestId, sale, error.uncertain ? 'uncertain' : 'failed', timings)
    next(error)
  }
})
app.post('/api/sales/:id/retry-card', async (req, res, next) => {
  let sale
  const requestId = crypto.randomUUID()
  const requestStartedAt = performance.now()
  const timings = {}
  try {
    requireProtectedPoint()
    const lookupStartedAt = performance.now()
    sale = await getSale(req.params.id)
    timings.lookup = elapsedMilliseconds(lookupStartedAt)
    if (!sale) return res.status(404).json({ error: 'Sale not found.' })
    if (sale.paymentMethod !== 'card' || sale.status !== 'pending') throw Object.assign(new Error('This card sale cannot be retried.'), { status: 409 })
    if (sale.mpOrderId) return res.json(sale)
    const mercadoPagoStartedAt = performance.now()
    const order = await createPointOrder(sale)
    timings.mercadopago = elapsedMilliseconds(mercadoPagoStartedAt)
    const persistStartedAt = performance.now()
    const attachedSale = await attachPointOrder(sale.id, order, sale)
    timings.persist = elapsedMilliseconds(persistStartedAt)
    timings.total = elapsedMilliseconds(requestStartedAt)
    sendPointTiming(res, requestId, timings)
    logPointTiming(requestId, attachedSale, 'created_after_retry', timings)
    res.json({ ...attachedSale, pointTiming: timings, requestId })
  } catch (error) {
    if (sale && !error.uncertain) await markCardSaleFailed(sale.id, error.mercadoPagoCode || 'order_creation_failed').catch(console.error)
    if (sale) error.saleId = sale.id
    timings.total = elapsedMilliseconds(requestStartedAt)
    sendPointTiming(res, requestId, timings)
    logPointTiming(requestId, sale, error.uncertain ? 'uncertain_after_retry' : 'retry_failed', timings)
    next(error)
  }
})
app.get('/api/sales/:id', async (req, res, next) => {
  try {
    let sale = await getSale(req.params.id)
    if (!sale) return res.status(404).json({ error: 'Sale not found.' })
    if (req.query.refresh === 'true' && sale.paymentMethod === 'card' && sale.status === 'pending' && sale.mpOrderId) {
      const previousPointStatus = sale.mpStatus
      const refreshStartedAt = performance.now()
      const mercadoPagoStartedAt = performance.now()
      const order = await getPointOrder(sale.mpOrderId, sale)
      const mercadoPagoDuration = elapsedMilliseconds(mercadoPagoStartedAt)
      const paymentId = order?.transactions?.payments?.[0]?.id || null
      const pointStateChanged = order.status !== sale.mpStatus
        || order.status_detail !== sale.mpStatusDetail
        || (paymentId && paymentId !== sale.mpPaymentId)
      let persistDuration = 0
      if (pointStateChanged) {
        const persistStartedAt = performance.now()
        sale = await updateSaleFromPoint(order)
        persistDuration = elapsedMilliseconds(persistStartedAt)
        if (sale.status !== 'pending') setImmediate(() => enrichPointPayment(sale, order).catch(console.error))
      }
      const timings = {
        mercadopago: mercadoPagoDuration,
        persist: persistDuration,
        total: elapsedMilliseconds(refreshStartedAt),
      }
      sendPointTiming(res, crypto.randomUUID(), timings)
      if (sale.mpStatus !== previousPointStatus || sale.status !== 'pending') {
        console.info(JSON.stringify({
          event: 'point_order_status',
          saleId: sale.id,
          from: previousPointStatus,
          to: sale.mpStatus,
          status: sale.status,
          ageMs: Date.now() - new Date(sale.createdAt).getTime(),
          timings,
        }))
      }
    }
    res.json(sale)
  } catch (error) { next(error) }
})
app.post('/api/sales/:id/reconcile-point', async (req, res, next) => {
  try {
    requireProtectedPoint()
    const sale = await getSale(req.params.id)
    if (!sale) return res.status(404).json({ error: 'Sale not found.' })
    if (sale.paymentMethod !== 'card' || !sale.mpOrderId) {
      throw Object.assign(new Error('This sale has no Point order to synchronize.'), { status: 409 })
    }
    res.json(await reconcilePointSale(sale))
  } catch (error) { next(error) }
})
app.post('/api/sales/:id/cancel', async (req, res, next) => {
  try {
    const sale = await getSale(req.params.id)
    if (!sale) return res.status(404).json({ error: 'Sale not found.' })
    if (sale.paymentMethod !== 'card' || sale.status !== 'pending') throw Object.assign(new Error('Only a pending card sale can be cancelled.'), { status: 409 })
    if (!sale.mpOrderId) throw Object.assign(new Error('Retry the Mercado Pago connection before cancelling this sale.'), { status: 409 })
    const order = await cancelPointOrder(sale.mpOrderId, sale)
    res.json(await updateSaleFromPoint(order))
  } catch (error) { next(error) }
})
app.post('/api/sales/:id/refunds', async (req, res, next) => {
  let prepared
  try {
    const existing = await getSale(req.params.id)
    if (!existing) return res.status(404).json({ error: 'Sale not found.' })
    if (existing.paymentMethod === 'card') requireProtectedPoint()
    prepared = await prepareRefund(existing.id, cleanRefund(req.body))
    if (!prepared) return res.status(404).json({ error: 'Sale not found.' })

    if (existing.paymentMethod === 'cash') {
      return res.status(201).json(await completeRefund(prepared.refund.id))
    }
    if (!existing.mpOrderId) throw Object.assign(new Error('This card sale has no Mercado Pago order to refund.'), { status: 409 })
    const order = await refundPointOrder(existing.mpOrderId, existing, { ...prepared.refund, full: prepared.full })
    res.status(201).json(await completeRefund(prepared.refund.id, order))
  } catch (error) {
    if (prepared?.refund && !error.uncertain) await failRefund(prepared.refund.id, error.mercadoPagoCode || error.message).catch(console.error)
    if (prepared?.refund) error.refundId = prepared.refund.id
    next(error)
  }
})
app.post('/api/sales/:saleId/refunds/:refundId/retry', async (req, res, next) => {
  try {
    requireProtectedPoint()
    const sale = await getSale(req.params.saleId)
    if (!sale) return res.status(404).json({ error: 'Sale not found.' })
    const refund = sale.refunds.find((entry) => entry.id === req.params.refundId)
    if (!refund) return res.status(404).json({ error: 'Refund not found.' })
    if (sale.paymentMethod !== 'card' || refund.status !== 'pending' || !sale.mpOrderId) {
      throw Object.assign(new Error('This refund cannot be retried.'), { status: 409 })
    }
    const order = await refundPointOrder(sale.mpOrderId, sale, {
      ...refund,
      full: sale.refundedTotal + refund.amount >= sale.total,
    })
    res.json(await completeRefund(refund.id, order))
  } catch (error) { next(error) }
})
app.patch('/api/sales/:saleId/refunds/:refundId/credit-note', async (req, res, next) => {
  try {
    const sale = await recordCreditNote(req.params.saleId, req.params.refundId, cleanCreditNote(req.body))
    if (!sale) return res.status(404).json({ error: 'Processed refund not found.' })
    res.json(sale)
  } catch (error) { next(error) }
})
app.patch('/api/sales/:saleId/refunds/:refundId/inventory-review', async (req, res, next) => {
  try {
    if (typeof req.body?.restock !== 'boolean') throw badRequest('Choose whether the returned products go back into inventory.')
    const sale = await resolveRefundInventoryReview(req.params.saleId, req.params.refundId, req.body.restock)
    if (!sale) return res.status(404).json({ error: 'Refund not found.' })
    res.json(sale)
  } catch (error) { next(error) }
})

app.get('/api/pos/config', (_req, res) => res.json(pointConfiguration()))
app.get('/api/pos/terminal', async (_req, res, next) => {
  try { requireProtectedPoint(); res.json(await getConfiguredTerminal()) } catch (error) { next(error) }
})

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }))

const distPath = path.join(root, 'dist')
app.use(express.static(distPath, {
  index: false,
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  },
}))
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(distPath, 'index.html'), {
  headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
}))

app.use((error, _req, res, _next) => {
  console.error(error)
  const status = error.status || 500
  res.status(status).json({
    error: status < 500 || error.status ? error.message : 'Something went wrong. Please try again.',
    ...(error.saleId ? { saleId: error.saleId } : {}),
    ...(error.refundId ? { refundId: error.refundId } : {}),
    ...(error.uncertain ? { uncertain: true } : {}),
  })
})

await initializeStore()
const server = app.listen(port, '0.0.0.0', () => console.log(`Bakery POS listening on port ${port}`))

async function shutdown() {
  server.close(async () => {
    await closeStore()
    process.exit(0)
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
