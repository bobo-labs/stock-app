import path from 'node:path'
import { fileURLToPath } from 'node:url'
import compression from 'compression'
import express from 'express'
import { authStatus, login, logout, pointAccessIsProtected, requireAuth } from './auth.js'
import {
  cancelPointOrder, createPointOrder, getConfiguredTerminal, getPointOrder,
  pointConfiguration, validatePointWebhook,
} from './mercadopago.js'
import {
  adjustItem, attachPointOrder, closeStore, createItem, createSale, deleteItem, getSale,
  getSaleByPointOrder, initializeStore, listItems, listMovements, listSales,
  markCardSaleFailed, updateItem, updateSaleFromPoint,
} from './store.js'

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

function requireProtectedPoint() {
  if (!pointConfiguration().configured) throw Object.assign(new Error('Point Smart 2 is not configured yet.'), { status: 503 })
  if (!pointAccessIsProtected() && !pointConfiguration().mockMode) {
    throw Object.assign(new Error('Set STAFF_PIN and SESSION_SECRET before enabling live Point payments.'), { status: 503 })
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.post('/api/mercadopago/webhook', (req, res) => {
  const dataId = String(req.query['data.id'] || req.body?.data?.id || '')
  const valid = validatePointWebhook({
    signature: req.headers['x-signature'],
    requestId: req.headers['x-request-id'],
    dataId,
  })
  if (!valid) return res.status(401).json({ error: 'Invalid webhook signature.' })
  res.status(200).end()

  setImmediate(async () => {
    try {
      const sale = await getSaleByPointOrder(dataId)
      if (!sale && pointConfiguration().mockMode) return
      const order = await getPointOrder(dataId, sale)
      await updateSaleFromPoint(order)
    } catch (error) {
      console.error('Mercado Pago webhook processing failed:', error)
    }
  })
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

app.get('/api/sales', async (req, res, next) => {
  try { res.json(await listSales(Math.min(Number(req.query.limit) || 50, 200))) } catch (error) { next(error) }
})
app.post('/api/sales/cash', async (req, res, next) => {
  try { res.status(201).json(await createSale(cleanCart(req.body), 'cash')) } catch (error) { next(error) }
})
app.post('/api/sales/card', async (req, res, next) => {
  let sale
  try {
    requireProtectedPoint()
    sale = await createSale(cleanCart(req.body), 'card')
    const order = await createPointOrder(sale)
    res.status(201).json(await attachPointOrder(sale.id, order))
  } catch (error) {
    if (sale && !error.uncertain) await markCardSaleFailed(sale.id, error.mercadoPagoCode || 'order_creation_failed').catch(console.error)
    if (sale) error.saleId = sale.id
    next(error)
  }
})
app.post('/api/sales/:id/retry-card', async (req, res, next) => {
  let sale
  try {
    requireProtectedPoint()
    sale = await getSale(req.params.id)
    if (!sale) return res.status(404).json({ error: 'Sale not found.' })
    if (sale.paymentMethod !== 'card' || sale.status !== 'pending') throw Object.assign(new Error('This card sale cannot be retried.'), { status: 409 })
    if (sale.mpOrderId) return res.json(sale)
    const order = await createPointOrder(sale)
    res.json(await attachPointOrder(sale.id, order))
  } catch (error) {
    if (sale && !error.uncertain) await markCardSaleFailed(sale.id, error.mercadoPagoCode || 'order_creation_failed').catch(console.error)
    if (sale) error.saleId = sale.id
    next(error)
  }
})
app.get('/api/sales/:id', async (req, res, next) => {
  try {
    let sale = await getSale(req.params.id)
    if (!sale) return res.status(404).json({ error: 'Sale not found.' })
    if (req.query.refresh === 'true' && sale.paymentMethod === 'card' && sale.status === 'pending' && sale.mpOrderId) {
      const order = await getPointOrder(sale.mpOrderId, sale)
      sale = await updateSaleFromPoint(order)
    }
    res.json(sale)
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

app.get('/api/pos/config', (_req, res) => res.json(pointConfiguration()))
app.get('/api/pos/terminal', async (_req, res, next) => {
  try { requireProtectedPoint(); res.json(await getConfiguredTerminal()) } catch (error) { next(error) }
})

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }))

app.use(express.static(path.join(root, 'dist'), { maxAge: '1h' }))
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')))

app.use((error, _req, res, _next) => {
  console.error(error)
  const status = error.status || 500
  res.status(status).json({
    error: status < 500 || error.status ? error.message : 'Something went wrong. Please try again.',
    ...(error.saleId ? { saleId: error.saleId } : {}),
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
