import path from 'node:path'
import { fileURLToPath } from 'node:url'
import compression from 'compression'
import express from 'express'
import { adjustItem, closeStore, createItem, initializeStore, listItems, listMovements, updateItem } from './store.js'

const app = express()
const port = Number(process.env.PORT || 3000)
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

app.disable('x-powered-by')
app.use(compression())
app.use(express.json({ limit: '200kb' }))

function cleanItem(body, isUpdate = false) {
  const item = {
    name: String(body.name || '').trim(),
    category: String(body.category || '').trim(),
    unit: String(body.unit || '').trim(),
    lowStockThreshold: Number(body.lowStockThreshold ?? 0),
    sku: String(body.sku || '').trim(),
    expiryDate: body.expiryDate || null,
  }
  if (!isUpdate) item.quantity = Number(body.quantity ?? 0)
  if (!item.name || !item.category || !item.unit) throw Object.assign(new Error('Name, category, and unit are required.'), { status: 400 })
  if ((!isUpdate && (!Number.isFinite(item.quantity) || item.quantity < 0)) || !Number.isFinite(item.lowStockThreshold) || item.lowStockThreshold < 0) {
    throw Object.assign(new Error('Quantities must be positive numbers.'), { status: 400 })
  }
  return item
}

app.get('/api/health', (_req, res) => res.json({ ok: true }))
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
app.post('/api/items/:id/adjust', async (req, res, next) => {
  try {
    const type = req.body.type
    const quantity = Number(req.body.quantity)
    if (!['stock_in', 'stock_out', 'adjustment'].includes(type)) throw Object.assign(new Error('Invalid stock action.'), { status: 400 })
    if (!Number.isFinite(quantity) || quantity < 0 || (type !== 'adjustment' && quantity === 0)) throw Object.assign(new Error('Enter a valid quantity.'), { status: 400 })
    const item = await adjustItem(req.params.id, { type, quantity, note: String(req.body.note || '').trim() })
    if (!item) return res.status(404).json({ error: 'Product not found.' })
    res.json(item)
  } catch (error) { next(error) }
})
app.get('/api/movements', async (req, res, next) => {
  try { res.json(await listMovements(Math.min(Number(req.query.limit) || 50, 200))) } catch (error) { next(error) }
})

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }))

app.use(express.static(path.join(root, 'dist'), { maxAge: '1h' }))
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')))

app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(error.status || 500).json({ error: error.status ? error.message : 'Something went wrong. Please try again.' })
})

await initializeStore()
const server = app.listen(port, '0.0.0.0', () => console.log(`Bakery Stock listening on port ${port}`))

async function shutdown() {
  server.close(async () => {
    await closeStore()
    process.exit(0)
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
