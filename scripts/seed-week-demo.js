import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const target = path.resolve(process.env.DATA_PATH || path.join(workspace, 'data', 'inventory.json'))
const dataDirectory = path.resolve(workspace, 'data')

if (!process.argv.includes('--yes')) {
  console.error('This replaces the local demo data. Run: npm run seed:week -- --yes')
  process.exit(1)
}
if (process.env.DATABASE_URL) {
  console.error('Refusing to seed while DATABASE_URL is set. This script is for the local JSON demo only.')
  process.exit(1)
}
if (target !== path.join(dataDirectory, 'inventory.json')) {
  console.error(`Refusing to write outside the standard local demo file: ${target}`)
  process.exit(1)
}

const definitions = [
  { name: 'Marraqueta', category: 'Bread', unit: 'pieces', sku: 'PAN-001', price: 500, threshold: 35, opening: 24, production: 105, weight: 18, minQty: 2, maxQty: 6, fresh: true },
  { name: 'Hallulla', category: 'Bread', unit: 'pieces', sku: 'PAN-002', price: 650, threshold: 28, opening: 20, production: 82, weight: 14, minQty: 2, maxQty: 5, fresh: true },
  { name: 'Pan amasado', category: 'Bread', unit: 'pieces', sku: 'PAN-003', price: 700, threshold: 18, opening: 16, production: 56, weight: 10, minQty: 1, maxQty: 4, fresh: true },
  { name: 'Croissant de mantequilla', category: 'Pastries', unit: 'pieces', sku: 'PAS-001', price: 1800, threshold: 10, opening: 10, production: 36, weight: 10, minQty: 1, maxQty: 2, fresh: true },
  { name: 'Berlín con crema', category: 'Pastries', unit: 'pieces', sku: 'PAS-002', price: 1600, threshold: 8, opening: 8, production: 29, weight: 8, minQty: 1, maxQty: 2, fresh: true },
  { name: 'Napoleón', category: 'Pastries', unit: 'pieces', sku: 'PAS-003', price: 2200, threshold: 6, opening: 6, production: 20, weight: 6, minQty: 1, maxQty: 2, fresh: true },
  { name: 'Pie de limón individual', category: 'Pastries', unit: 'pieces', sku: 'PAS-004', price: 2500, threshold: 7, opening: 7, production: 23, weight: 7, minQty: 1, maxQty: 2, fresh: true },
  { name: 'Empanada de queso', category: 'Pastries', unit: 'pieces', sku: 'SAL-001', price: 2400, threshold: 10, opening: 9, production: 34, weight: 9, minQty: 1, maxQty: 3, fresh: true },
  { name: 'Alfajor artesanal', category: 'Pastries', unit: 'pieces', sku: 'PAS-005', price: 1400, threshold: 9, opening: 12, production: 31, weight: 7, minQty: 1, maxQty: 3, fresh: true },
  { name: 'Porción torta de chocolate', category: 'Cakes', unit: 'pieces', sku: 'TOR-001', price: 3200, threshold: 6, opening: 6, production: 18, weight: 5, minQty: 1, maxQty: 2, fresh: true },
  { name: 'Café americano', category: 'Drinks', unit: 'pieces', sku: 'BEB-001', price: 1800, threshold: 12, opening: 18, production: 45, weight: 9, minQty: 1, maxQty: 2, fresh: false },
  { name: 'Jugo de naranja', category: 'Drinks', unit: 'bottles', sku: 'BEB-002', price: 2000, threshold: 10, opening: 16, production: 26, weight: 5, minQty: 1, maxQty: 2, fresh: false },
  { name: 'Harina panadera', category: 'Ingredients', unit: 'kg', sku: 'ING-001', price: 0, threshold: 20, opening: 65, production: 0, sellable: false },
  { name: 'Mantequilla', category: 'Ingredients', unit: 'kg', sku: 'ING-002', price: 0, threshold: 8, opening: 24, production: 0, sellable: false },
  { name: 'Cajas para torta', category: 'Packaging', unit: 'boxes', sku: 'EMP-001', price: 0, threshold: 15, opening: 34, production: 0, sellable: false },
]

let randomState = 0x51f15e
function random() {
  randomState = (randomState * 1664525 + 1013904223) >>> 0
  return randomState / 4294967296
}
function integer(min, max) { return Math.floor(random() * (max - min + 1)) + min }
function chooseWeighted(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0)
  let cursor = random() * total
  for (const entry of entries) {
    cursor -= entry.weight
    if (cursor <= 0) return entry
  }
  return entries.at(-1)
}
function shortId(id) { return id.replaceAll('-', '').slice(0, 8).toUpperCase() }
function dateKeyFromUtc(date) { return date.toISOString().slice(0, 10) }
function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return dateKeyFromUtc(date)
}
function santiagoParts(value = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value).map((part) => [part.type, part.value]))
}
function zonedInstant(dateKey, hour, minute) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute)
  let candidate = targetUtc
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = santiagoParts(new Date(candidate))
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute))
    candidate += targetUtc - represented
  }
  return new Date(candidate).toISOString()
}
function expiryFromToday(todayKey, days) { return addDays(todayKey, days) }

const now = new Date()
const nowParts = santiagoParts(now)
const todayKey = `${nowParts.year}-${nowParts.month}-${nowParts.day}`
const currentHour = Number(nowParts.hour)
const days = Array.from({ length: 7 }, (_, index) => addDays(todayKey, index - 6))
const initialTimestamp = zonedInstant(days[0], 5, 20)
const movements = []
const sales = []
const cashClosures = []
const balances = new Map()
const items = definitions.map((definition, index) => {
  const id = crypto.randomUUID()
  balances.set(id, definition.opening)
  movements.push({
    id: crypto.randomUUID(), itemId: id, itemName: definition.name, saleId: null, type: 'stock_in',
    quantity: definition.opening, balanceAfter: definition.opening, note: 'Opening stock', createdAt: initialTimestamp,
  })
  return {
    id, name: definition.name, category: definition.category, unit: definition.unit,
    quantity: definition.opening, lowStockThreshold: definition.threshold, sku: definition.sku,
    expiryDate: definition.sellable === false ? (definition.category === 'Packaging' ? null : expiryFromToday(todayKey, 45)) : expiryFromToday(todayKey, definition.fresh ? 2 : 20),
    price: definition.price, sellable: definition.sellable !== false, createdAt: initialTimestamp, updatedAt: initialTimestamp,
    demo: definition,
  }
})
const sellableItems = items.filter((item) => item.sellable)

const hourWeights = [
  { hour: 7, weight: 7 }, { hour: 8, weight: 16 }, { hour: 9, weight: 18 }, { hour: 10, weight: 13 },
  { hour: 11, weight: 8 }, { hour: 12, weight: 9 }, { hour: 13, weight: 7 }, { hour: 14, weight: 6 },
  { hour: 15, weight: 7 }, { hour: 16, weight: 10 }, { hour: 17, weight: 14 }, { hour: 18, weight: 11 }, { hour: 19, weight: 5 },
]

for (const [dayIndex, dayKey] of days.entries()) {
  const weekday = new Date(`${dayKey}T12:00:00Z`).getUTCDay()
  const weekendMultiplier = weekday === 6 ? 1.35 : weekday === 0 ? 1.2 : 1
  const completedDay = dayKey !== todayKey
  let plannedSales = Math.round((weekday === 6 ? 78 : weekday === 0 ? 68 : 55) + integer(-5, 6))
  if (!completedDay) {
    const elapsedShare = Math.max(0.18, Math.min(1, (currentHour - 6) / 13))
    plannedSales = Math.max(12, Math.round(plannedSales * elapsedShare))
  }

  for (const item of sellableItems) {
    const production = Math.round(item.demo.production * weekendMultiplier)
    balances.set(item.id, balances.get(item.id) + production)
    const timestamp = zonedInstant(dayKey, 6, integer(2, 24))
    movements.push({
      id: crypto.randomUUID(), itemId: item.id, itemName: item.name, saleId: null, type: 'stock_in',
      quantity: production, balanceAfter: balances.get(item.id), note: 'Producción del día', createdAt: timestamp,
    })
    item.updatedAt = timestamp
  }

  const daySales = []
  for (let saleIndex = 0; saleIndex < plannedSales; saleIndex += 1) {
    const availableHours = completedDay ? hourWeights : hourWeights.filter((entry) => entry.hour <= Math.max(7, currentHour - 1))
    const selectedHour = chooseWeighted(availableHours.length ? availableHours : [hourWeights[0]]).hour
    const createdAt = zonedInstant(dayKey, selectedHour, integer(0, 57))
    const paymentMethod = random() < 0.42 ? 'cash' : 'card'
    const outcomeRoll = random()
    const status = paymentMethod === 'cash' ? 'paid' : outcomeRoll < 0.955 ? 'paid' : outcomeRoll < 0.982 ? 'failed' : 'cancelled'
    const lineCount = random() < 0.54 ? 1 : random() < 0.84 ? 2 : 3
    const selected = new Set()
    const lines = []
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
      const candidates = sellableItems.filter((item) => !selected.has(item.id) && balances.get(item.id) > item.demo.minQty)
      if (!candidates.length) break
      const item = chooseWeighted(candidates.map((entry) => ({ ...entry, weight: entry.demo.weight })))
      selected.add(item.id)
      const maxQuantity = Math.min(item.demo.maxQty, Math.max(item.demo.minQty, Math.floor(balances.get(item.id))))
      const quantity = integer(item.demo.minQty, maxQuantity)
      lines.push({ item, quantity, unitPrice: item.price, lineTotal: item.price * quantity })
    }
    if (!lines.length) continue
    const id = crypto.randomUUID()
    const total = lines.reduce((sum, line) => sum + line.lineTotal, 0)
    const paidAt = status === 'paid' ? new Date(new Date(createdAt).getTime() + integer(25, 150) * 1000).toISOString() : null
    const sale = {
      id, status, paymentMethod, total,
      items: lines.map((line) => ({ itemId: line.item.id, name: line.item.name, unit: line.item.unit, quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: line.lineTotal })),
      mpOrderId: paymentMethod === 'card' ? `DEMO-${id}` : null,
      mpPaymentId: paymentMethod === 'card' && status === 'paid' ? `PAY-${id}` : null,
      mpStatus: paymentMethod === 'card' ? (status === 'paid' ? 'processed' : status) : null,
      mpStatusDetail: paymentMethod === 'card' ? (status === 'paid' ? 'accredited' : status) : null,
      inventoryApplied: status === 'paid', createdAt, updatedAt: paidAt || createdAt, paidAt,
    }
    if (status === 'paid') {
      for (const line of lines) {
        balances.set(line.item.id, balances.get(line.item.id) - line.quantity)
        movements.push({
          id: crypto.randomUUID(), itemId: line.item.id, itemName: line.item.name, saleId: id, type: 'stock_out',
          quantity: -line.quantity, balanceAfter: balances.get(line.item.id),
          note: paymentMethod === 'cash' ? `Sale #${shortId(id)}` : `Reserved for card sale #${shortId(id)}`, createdAt,
        })
        line.item.updatedAt = createdAt
      }
    }
    sales.push(sale)
    daySales.push(sale)
  }

  if (!completedDay) {
    const pendingItem = sellableItems.find((item) => balances.get(item.id) >= 2)
    if (pendingItem) {
      const id = crypto.randomUUID()
      const quantity = 1
      const createdAt = zonedInstant(dayKey, Math.max(7, currentHour - 1), 52)
      balances.set(pendingItem.id, balances.get(pendingItem.id) - quantity)
      const pendingSale = {
        id, status: 'pending', paymentMethod: 'card', total: pendingItem.price,
        items: [{ itemId: pendingItem.id, name: pendingItem.name, unit: pendingItem.unit, quantity, unitPrice: pendingItem.price, lineTotal: pendingItem.price }],
        mpOrderId: `DEMO-PENDING-${id}`, mpPaymentId: null, mpStatus: 'action_required', mpStatusDetail: 'waiting_payment',
        inventoryApplied: true, createdAt, updatedAt: createdAt, paidAt: null,
      }
      sales.push(pendingSale); daySales.push(pendingSale)
      movements.push({
        id: crypto.randomUUID(), itemId: pendingItem.id, itemName: pendingItem.name, saleId: id, type: 'stock_out',
        quantity: -quantity, balanceAfter: balances.get(pendingItem.id), note: `Reserved for card sale #${shortId(id)}`, createdAt,
      })
    }
  }

  if (completedDay) {
    for (const item of sellableItems.filter((entry) => entry.demo.fresh)) {
      const target = Math.max(2, Math.round(item.lowStockThreshold * (0.55 + random() * 0.65)))
      const waste = Math.max(0, Math.floor(balances.get(item.id) - target))
      if (waste <= 0) continue
      balances.set(item.id, balances.get(item.id) - waste)
      const timestamp = zonedInstant(dayKey, 20, integer(5, 24))
      movements.push({
        id: crypto.randomUUID(), itemId: item.id, itemName: item.name, saleId: null, type: 'stock_out',
        quantity: -waste, balanceAfter: balances.get(item.id), note: 'Merma de cierre', createdAt: timestamp,
      })
      item.updatedAt = timestamp
    }
  }

  const paid = daySales.filter((sale) => sale.status === 'paid')
  const cashSales = paid.filter((sale) => sale.paymentMethod === 'cash').reduce((sum, sale) => sum + sale.total, 0)
  const cardSales = paid.filter((sale) => sale.paymentMethod === 'card').reduce((sum, sale) => sum + sale.total, 0)
  const openingCash = 50000
  const cashAdjustments = cashSales > 180000 ? -100000 : cashSales > 90000 ? -50000 : 0
  const expectedCash = openingCash + cashSales + cashAdjustments
  const differences = [0, 0, 500, -500, 0, 1000, 0]
  const difference = differences[dayIndex]
  cashClosures.push({
    id: crypto.randomUUID(), businessDate: dayKey, openingCash, cashAdjustments,
    countedCash: expectedCash + difference, cashSales, cardSales, totalSales: cashSales + cardSales,
    expectedCash, difference, transactionCount: paid.length,
    note: difference === 0 ? 'Caja conciliada sin diferencias.' : 'Diferencia revisada y registrada por el encargado.',
    closedAt: zonedInstant(dayKey, completedDay ? 20 : Math.max(8, currentHour), completedDay ? 35 : 5),
  })
}

const napoleon = items.find((item) => item.name === 'Napoleón')
if (napoleon && balances.get(napoleon.id) > 4) {
  const adjustment = balances.get(napoleon.id) - 4
  balances.set(napoleon.id, 4)
  const timestamp = new Date(now.getTime() - 8 * 60000).toISOString()
  movements.push({ id: crypto.randomUUID(), itemId: napoleon.id, itemName: napoleon.name, saleId: null, type: 'stock_out', quantity: -adjustment, balanceAfter: 4, note: 'Merma registrada', createdAt: timestamp })
  napoleon.updatedAt = timestamp
}
const boxes = items.find((item) => item.name === 'Cajas para torta')
if (boxes && balances.get(boxes.id) !== 12) {
  const previous = balances.get(boxes.id)
  balances.set(boxes.id, 12)
  const timestamp = new Date(now.getTime() - 18 * 60000).toISOString()
  movements.push({ id: crypto.randomUUID(), itemId: boxes.id, itemName: boxes.name, saleId: null, type: 'adjustment', quantity: 12 - previous, balanceAfter: 12, note: 'Conteo físico semanal', createdAt: timestamp })
  boxes.updatedAt = timestamp
}

for (const item of items) {
  let chronologicalBalance = 0
  const itemMovements = movements
    .filter((movement) => movement.itemId === item.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
  for (const movement of itemMovements) {
    chronologicalBalance = Number((chronologicalBalance + movement.quantity).toFixed(2))
    if (chronologicalBalance < 0) throw new Error(`${item.name} would have negative stock at ${movement.createdAt}.`)
    movement.balanceAfter = chronologicalBalance
  }
  item.quantity = chronologicalBalance
  if (itemMovements.length) item.updatedAt = itemMovements.at(-1).createdAt
  delete item.demo
}
sales.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
movements.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
cashClosures.sort((a, b) => b.businessDate.localeCompare(a.businessDate))

await fs.mkdir(dataDirectory, { recursive: true })
try {
  await fs.access(target)
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  await fs.copyFile(target, path.join(dataDirectory, `inventory.before-week-demo-${stamp}.json`))
} catch {}

const data = { items, movements, sales, cashClosures }
await fs.writeFile(target, JSON.stringify(data, null, 2))
const paidSales = sales.filter((sale) => sale.status === 'paid')
console.log(JSON.stringify({
  target, days: [days[0], days.at(-1)], products: items.length, sales: sales.length,
  paidSales: paidSales.length, revenue: paidSales.reduce((sum, sale) => sum + sale.total, 0),
  movements: movements.length, cashClosures: cashClosures.length,
}, null, 2))
