import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import { dateOnly } from '../src/dates.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
const dataPath = process.env.DATA_PATH || path.join(process.cwd(), 'data', 'inventory.json')
let pool = null
let fileQueue = Promise.resolve()

const demoItems = [
  { name: 'Butter croissant', category: 'Pastries', unit: 'pieces', quantity: 28, lowStockThreshold: 10, sku: 'PAS-001', expiryDate: tomorrow(1), price: 1800, sellable: true },
  { name: 'Sourdough loaf', category: 'Bread', unit: 'loaves', quantity: 8, lowStockThreshold: 8, sku: 'BRD-001', expiryDate: tomorrow(2), price: 4200, sellable: true },
  { name: 'Chocolate éclair', category: 'Pastries', unit: 'pieces', quantity: 5, lowStockThreshold: 8, sku: 'PAS-004', expiryDate: tomorrow(1), price: 2200, sellable: true },
  { name: 'All-purpose flour', category: 'Ingredients', unit: 'kg', quantity: 42, lowStockThreshold: 15, sku: 'ING-001', expiryDate: tomorrow(90), price: 0, sellable: false },
  { name: 'Cake boxes', category: 'Packaging', unit: 'boxes', quantity: 12, lowStockThreshold: 20, sku: 'PKG-003', expiryDate: null, price: 0, sellable: false },
]

function tomorrow(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function shortId(id) {
  return id.replaceAll('-', '').slice(0, 8).toUpperCase()
}

function normalizeItem(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    quantity: Number(row.quantity),
    lowStockThreshold: Number(row.low_stock_threshold ?? row.lowStockThreshold ?? 0),
    sku: row.sku || '',
    expiryDate: dateOnly(row.expiry_date ?? row.expiryDate),
    price: Number(row.price || 0),
    sellable: Boolean(row.sellable),
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  }
}

function normalizeMovement(row) {
  return {
    id: row.id,
    itemId: row.item_id ?? row.itemId,
    itemName: row.item_name ?? row.itemName,
    saleId: row.sale_id ?? row.saleId ?? null,
    type: row.type,
    quantity: Number(row.quantity),
    balanceAfter: Number(row.balance_after ?? row.balanceAfter),
    note: row.note || '',
    createdAt: row.created_at ?? row.createdAt,
  }
}

function normalizeSale(row, items = row.items || []) {
  return {
    id: row.id,
    shortId: shortId(row.id),
    status: row.status,
    paymentMethod: row.payment_method ?? row.paymentMethod,
    total: Number(row.total),
    items: items.map((item) => ({
      itemId: item.item_id ?? item.itemId,
      name: item.item_name ?? item.name,
      unit: item.unit,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price ?? item.unitPrice),
      lineTotal: Number(item.line_total ?? item.lineTotal),
    })),
    mpOrderId: row.mp_order_id ?? row.mpOrderId ?? null,
    mpPaymentId: row.mp_payment_id ?? row.mpPaymentId ?? null,
    mpStatus: row.mp_status ?? row.mpStatus ?? null,
    mpStatusDetail: row.mp_status_detail ?? row.mpStatusDetail ?? null,
    inventoryApplied: Boolean(row.inventory_applied ?? row.inventoryApplied),
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
    paidAt: row.paid_at ?? row.paidAt ?? null,
  }
}

function normalizeCashClosure(row) {
  if (!row) return null
  return {
    id: row.id,
    businessDate: dateOnly(row.business_date ?? row.businessDate),
    openingCash: Number(row.opening_cash ?? row.openingCash ?? 0),
    cashAdjustments: Number(row.cash_adjustments ?? row.cashAdjustments ?? 0),
    countedCash: Number(row.counted_cash ?? row.countedCash ?? 0),
    cashSales: Number(row.cash_sales ?? row.cashSales ?? 0),
    cardSales: Number(row.card_sales ?? row.cardSales ?? 0),
    totalSales: Number(row.total_sales ?? row.totalSales ?? 0),
    expectedCash: Number(row.expected_cash ?? row.expectedCash ?? 0),
    difference: Number(row.difference ?? 0),
    transactionCount: Number(row.transaction_count ?? row.transactionCount ?? 0),
    note: row.note || '',
    closedAt: row.closed_at ?? row.closedAt,
  }
}

function ensureFileShape(data) {
  data.items ||= []
  data.movements ||= []
  data.sales ||= []
  data.cashClosures ||= []
  for (const item of data.items) {
    item.price = Number(item.price || 0)
    item.sellable = Boolean(item.sellable)
  }
  return data
}

export async function initializeStore() {
  if (databaseUrl) {
    const useSsl = !databaseUrl.includes('railway.internal') && process.env.PGSSLMODE !== 'disable'
    pool = new Pool({ connectionString: databaseUrl, ssl: useSsl ? { rejectUnauthorized: false } : false })
    await pool.query(`
      CREATE TABLE IF NOT EXISTS items (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        unit TEXT NOT NULL,
        quantity NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        low_stock_threshold NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
        sku TEXT NOT NULL DEFAULT '',
        expiry_date DATE,
        price NUMERIC(12,0) NOT NULL DEFAULT 0 CHECK (price >= 0),
        sellable BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE items ADD COLUMN IF NOT EXISTS price NUMERIC(12,0) NOT NULL DEFAULT 0 CHECK (price >= 0);
      ALTER TABLE items ADD COLUMN IF NOT EXISTS sellable BOOLEAN NOT NULL DEFAULT FALSE;

      CREATE TABLE IF NOT EXISTS sales (
        id UUID PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('pending','paid','failed','cancelled','expired','refunded')),
        payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','card')),
        total NUMERIC(12,0) NOT NULL CHECK (total >= 0),
        mp_order_id TEXT UNIQUE,
        mp_payment_id TEXT,
        mp_status TEXT,
        mp_status_detail TEXT,
        inventory_applied BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        paid_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS sale_items (
        id UUID PRIMARY KEY,
        sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        item_id UUID REFERENCES items(id) ON DELETE SET NULL,
        item_name TEXT NOT NULL,
        unit TEXT NOT NULL,
        quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
        unit_price NUMERIC(12,0) NOT NULL CHECK (unit_price >= 0),
        line_total NUMERIC(12,0) NOT NULL CHECK (line_total >= 0)
      );
      CREATE TABLE IF NOT EXISTS movements (
        id UUID PRIMARY KEY,
        item_id UUID REFERENCES items(id) ON DELETE SET NULL,
        item_name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('stock_in', 'stock_out', 'adjustment')),
        quantity NUMERIC(12,2) NOT NULL,
        balance_after NUMERIC(12,2) NOT NULL CHECK (balance_after >= 0),
        note TEXT NOT NULL DEFAULT '',
        sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS cash_closures (
        id UUID PRIMARY KEY,
        business_date DATE NOT NULL UNIQUE,
        opening_cash NUMERIC(12,0) NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
        cash_adjustments NUMERIC(12,0) NOT NULL DEFAULT 0,
        counted_cash NUMERIC(12,0) NOT NULL DEFAULT 0 CHECK (counted_cash >= 0),
        cash_sales NUMERIC(12,0) NOT NULL DEFAULT 0 CHECK (cash_sales >= 0),
        card_sales NUMERIC(12,0) NOT NULL DEFAULT 0 CHECK (card_sales >= 0),
        total_sales NUMERIC(12,0) NOT NULL DEFAULT 0 CHECK (total_sales >= 0),
        expected_cash NUMERIC(12,0) NOT NULL DEFAULT 0,
        difference NUMERIC(12,0) NOT NULL DEFAULT 0,
        transaction_count INTEGER NOT NULL DEFAULT 0 CHECK (transaction_count >= 0),
        note TEXT NOT NULL DEFAULT '',
        closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE movements ADD COLUMN IF NOT EXISTS sale_id UUID REFERENCES sales(id) ON DELETE SET NULL;
      ALTER TABLE sale_items ALTER COLUMN item_id DROP NOT NULL;
      ALTER TABLE movements ALTER COLUMN item_id DROP NOT NULL;
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'sale_items'::regclass AND conname = 'sale_items_item_id_fkey' AND confdeltype <> 'n'
        ) THEN
          ALTER TABLE sale_items DROP CONSTRAINT sale_items_item_id_fkey;
          ALTER TABLE sale_items ADD CONSTRAINT sale_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL;
        END IF;
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'movements'::regclass AND conname = 'movements_item_id_fkey' AND confdeltype <> 'n'
        ) THEN
          ALTER TABLE movements DROP CONSTRAINT movements_item_id_fkey;
          ALTER TABLE movements ADD CONSTRAINT movements_item_id_fkey FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL;
        END IF;
      END $$;
      CREATE INDEX IF NOT EXISTS movements_created_at_idx ON movements(created_at DESC);
      CREATE INDEX IF NOT EXISTS sales_created_at_idx ON sales(created_at DESC);
      CREATE INDEX IF NOT EXISTS sales_mp_order_id_idx ON sales(mp_order_id);
      CREATE INDEX IF NOT EXISTS sale_items_sale_id_idx ON sale_items(sale_id);
      CREATE INDEX IF NOT EXISTS cash_closures_business_date_idx ON cash_closures(business_date DESC);
    `)
    return
  }

  await fs.mkdir(path.dirname(dataPath), { recursive: true })
  try {
    await fs.access(dataPath)
    const data = ensureFileShape(await readFileData())
    await fs.writeFile(dataPath, JSON.stringify(data, null, 2))
  } catch {
    const data = { items: [], movements: [], sales: [], cashClosures: [] }
    if (process.env.SEED_DEMO_DATA === 'true') {
      for (const item of demoItems) addItemToData(data, item)
    }
    await fs.writeFile(dataPath, JSON.stringify(data, null, 2))
  }
}

async function readFileData() {
  return ensureFileShape(JSON.parse(await fs.readFile(dataPath, 'utf8')))
}

function mutateFileData(callback) {
  const operation = fileQueue.then(async () => {
    const data = await readFileData()
    const result = await callback(data)
    await fs.writeFile(dataPath, JSON.stringify(data, null, 2))
    return result
  })
  fileQueue = operation.catch(() => {})
  return operation
}

function addItemToData(data, input) {
  const now = new Date().toISOString()
  const item = {
    id: crypto.randomUUID(),
    name: input.name,
    category: input.category,
    unit: input.unit,
    quantity: Number(input.quantity || 0),
    lowStockThreshold: Number(input.lowStockThreshold || 0),
    sku: input.sku || '',
    expiryDate: input.expiryDate || null,
    price: Number(input.price || 0),
    sellable: Boolean(input.sellable),
    createdAt: now,
    updatedAt: now,
  }
  data.items.push(item)
  if (item.quantity > 0) {
    data.movements.unshift({
      id: crypto.randomUUID(), itemId: item.id, itemName: item.name, saleId: null, type: 'stock_in',
      quantity: item.quantity, balanceAfter: item.quantity, note: 'Opening stock', createdAt: now,
    })
  }
  return item
}

export async function listItems() {
  if (pool) {
    const { rows } = await pool.query('SELECT * FROM items ORDER BY name ASC')
    return rows.map(normalizeItem)
  }
  const data = await readFileData()
  return data.items.sort((a, b) => a.name.localeCompare(b.name)).map(normalizeItem)
}

export async function createItem(input) {
  if (!pool) return mutateFileData((data) => addItemToData(data, input))

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const id = crypto.randomUUID()
    const { rows } = await client.query(
      `INSERT INTO items (id, name, category, unit, quantity, low_stock_threshold, sku, expiry_date, price, sellable)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [id, input.name, input.category, input.unit, input.quantity, input.lowStockThreshold, input.sku, input.expiryDate || null, input.price, input.sellable],
    )
    if (Number(input.quantity) > 0) {
      await client.query(
        `INSERT INTO movements (id, item_id, item_name, type, quantity, balance_after, note)
         VALUES ($1,$2,$3,'stock_in',$4,$4,'Opening stock')`,
        [crypto.randomUUID(), id, input.name, input.quantity],
      )
    }
    await client.query('COMMIT')
    return normalizeItem(rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function updateItem(id, input) {
  if (!pool) {
    return mutateFileData((data) => {
      const item = data.items.find((entry) => entry.id === id)
      if (!item) return null
      Object.assign(item, input, { updatedAt: new Date().toISOString() })
      return normalizeItem(item)
    })
  }
  const { rows } = await pool.query(
    `UPDATE items SET name=$2, category=$3, unit=$4, low_stock_threshold=$5, sku=$6,
     expiry_date=$7, price=$8, sellable=$9, updated_at=NOW() WHERE id=$1 RETURNING *`,
    [id, input.name, input.category, input.unit, input.lowStockThreshold, input.sku, input.expiryDate || null, input.price, input.sellable],
  )
  return rows[0] ? normalizeItem(rows[0]) : null
}

export async function deleteItem(id) {
  if (!pool) {
    return mutateFileData((data) => {
      const index = data.items.findIndex((entry) => entry.id === id)
      if (index === -1) return null
      const pendingSale = data.sales.some((sale) => sale.status === 'pending' && sale.items.some((line) => line.itemId === id))
      if (pendingSale) throw Object.assign(new Error('This product is reserved by a pending card sale and cannot be deleted yet.'), { status: 409 })
      const [item] = data.items.splice(index, 1)
      for (const movement of data.movements) if (movement.itemId === id) movement.itemId = null
      for (const sale of data.sales) {
        for (const line of sale.items) if (line.itemId === id) line.itemId = null
      }
      return normalizeItem(item)
    })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const itemResult = await client.query('SELECT * FROM items WHERE id=$1 FOR UPDATE', [id])
    if (!itemResult.rows[0]) {
      await client.query('ROLLBACK')
      return null
    }
    const pendingResult = await client.query(
      `SELECT 1 FROM sale_items si JOIN sales s ON s.id=si.sale_id
       WHERE si.item_id=$1 AND s.status='pending' LIMIT 1`,
      [id],
    )
    if (pendingResult.rows[0]) {
      throw Object.assign(new Error('This product is reserved by a pending card sale and cannot be deleted yet.'), { status: 409 })
    }
    await client.query('DELETE FROM items WHERE id=$1', [id])
    await client.query('COMMIT')
    return normalizeItem(itemResult.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function adjustItem(id, input) {
  if (!pool) {
    return mutateFileData((data) => {
      const item = data.items.find((entry) => entry.id === id)
      if (!item) return null
      const amount = Number(input.quantity)
      const next = input.type === 'stock_in' ? item.quantity + amount
        : input.type === 'stock_out' ? item.quantity - amount : amount
      if (next < 0) throw Object.assign(new Error('Stock cannot go below zero.'), { status: 400 })
      const delta = input.type === 'adjustment' ? next - item.quantity : (input.type === 'stock_out' ? -amount : amount)
      item.quantity = next
      item.updatedAt = new Date().toISOString()
      data.movements.unshift({
        id: crypto.randomUUID(), itemId: item.id, itemName: item.name, saleId: null, type: input.type,
        quantity: delta, balanceAfter: next, note: input.note || '', createdAt: item.updatedAt,
      })
      return normalizeItem(item)
    })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const currentResult = await client.query('SELECT * FROM items WHERE id=$1 FOR UPDATE', [id])
    if (!currentResult.rows[0]) {
      await client.query('ROLLBACK')
      return null
    }
    const current = Number(currentResult.rows[0].quantity)
    const amount = Number(input.quantity)
    const next = input.type === 'stock_in' ? current + amount
      : input.type === 'stock_out' ? current - amount : amount
    if (next < 0) throw Object.assign(new Error('Stock cannot go below zero.'), { status: 400 })
    const delta = input.type === 'adjustment' ? next - current : (input.type === 'stock_out' ? -amount : amount)
    const { rows } = await client.query('UPDATE items SET quantity=$2, updated_at=NOW() WHERE id=$1 RETURNING *', [id, next])
    await client.query(
      `INSERT INTO movements (id, item_id, item_name, type, quantity, balance_after, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [crypto.randomUUID(), id, rows[0].name, input.type, delta, next, input.note || ''],
    )
    await client.query('COMMIT')
    return normalizeItem(rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function validateSaleLines(items, requested) {
  const itemMap = new Map(items.map((item) => [item.id, item]))
  return requested.map((line) => {
    const item = itemMap.get(line.itemId)
    if (!item) throw Object.assign(new Error('One of the selected products no longer exists.'), { status: 400 })
    if (!item.sellable || Number(item.price) <= 0) throw Object.assign(new Error(`${item.name} is not configured for sale.`), { status: 400 })
    if (Number(item.quantity) < line.quantity) throw Object.assign(new Error(`There is not enough stock for ${item.name}.`), { status: 409 })
    const lineTotal = Math.round(Number(item.price) * line.quantity)
    return { item, quantity: line.quantity, unitPrice: Number(item.price), lineTotal }
  })
}

function reserveSaleInFile(data, requested, paymentMethod) {
  const lines = validateSaleLines(data.items.map(normalizeItem), requested)
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  const total = lines.reduce((sum, line) => sum + line.lineTotal, 0)
  const sale = {
    id,
    status: paymentMethod === 'cash' ? 'paid' : 'pending',
    paymentMethod,
    total,
    items: lines.map(({ item, quantity, unitPrice, lineTotal }) => ({ itemId: item.id, name: item.name, unit: item.unit, quantity, unitPrice, lineTotal })),
    mpOrderId: null,
    mpPaymentId: null,
    mpStatus: null,
    mpStatusDetail: null,
    inventoryApplied: true,
    createdAt: now,
    updatedAt: now,
    paidAt: paymentMethod === 'cash' ? now : null,
  }
  for (const line of lines) {
    const item = data.items.find((entry) => entry.id === line.item.id)
    item.quantity = Number(item.quantity) - line.quantity
    item.updatedAt = now
    data.movements.unshift({
      id: crypto.randomUUID(), itemId: item.id, itemName: item.name, saleId: id, type: 'stock_out',
      quantity: -line.quantity, balanceAfter: item.quantity,
      note: paymentMethod === 'cash' ? `Sale #${shortId(id)}` : `Reserved for card sale #${shortId(id)}`,
      createdAt: now,
    })
  }
  data.sales.unshift(sale)
  return normalizeSale(sale)
}

export async function createSale(requested, paymentMethod) {
  if (!pool) return mutateFileData((data) => reserveSaleInFile(data, requested, paymentMethod))

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const ids = [...new Set(requested.map((line) => line.itemId))].sort()
    const itemResult = await client.query('SELECT * FROM items WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids])
    const lines = validateSaleLines(itemResult.rows.map(normalizeItem), requested)
    const id = crypto.randomUUID()
    const total = lines.reduce((sum, line) => sum + line.lineTotal, 0)
    const status = paymentMethod === 'cash' ? 'paid' : 'pending'
    const saleResult = await client.query(
      `INSERT INTO sales (id, status, payment_method, total, inventory_applied, paid_at)
       VALUES ($1,$2,$3,$4,TRUE,CASE WHEN $2='paid' THEN NOW() ELSE NULL END) RETURNING *`,
      [id, status, paymentMethod, total],
    )
    for (const line of lines) {
      await client.query(
        `INSERT INTO sale_items (id, sale_id, item_id, item_name, unit, quantity, unit_price, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [crypto.randomUUID(), id, line.item.id, line.item.name, line.item.unit, line.quantity, line.unitPrice, line.lineTotal],
      )
      const updated = await client.query(
        'UPDATE items SET quantity=quantity-$2, updated_at=NOW() WHERE id=$1 RETURNING quantity',
        [line.item.id, line.quantity],
      )
      await client.query(
        `INSERT INTO movements (id, item_id, item_name, type, quantity, balance_after, note, sale_id)
         VALUES ($1,$2,$3,'stock_out',$4,$5,$6,$7)`,
        [crypto.randomUUID(), line.item.id, line.item.name, -line.quantity, updated.rows[0].quantity,
          paymentMethod === 'cash' ? `Sale #${shortId(id)}` : `Reserved for card sale #${shortId(id)}`, id],
      )
    }
    await client.query('COMMIT')
    return normalizeSale(saleResult.rows[0], lines.map((line) => ({
      item_id: line.item.id, item_name: line.item.name, unit: line.item.unit,
      quantity: line.quantity, unit_price: line.unitPrice, line_total: line.lineTotal,
    })))
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function attachPointOrder(saleId, order) {
  const payment = order?.transactions?.payments?.[0]
  if (!pool) {
    return mutateFileData((data) => {
      const sale = data.sales.find((entry) => entry.id === saleId)
      if (!sale) return null
      sale.mpOrderId = order.id
      sale.mpPaymentId = payment?.id || null
      sale.mpStatus = order.status || null
      sale.mpStatusDetail = order.status_detail || null
      sale.updatedAt = new Date().toISOString()
      return normalizeSale(sale)
    })
  }
  const { rows } = await pool.query(
    `UPDATE sales SET mp_order_id=$2, mp_payment_id=$3, mp_status=$4, mp_status_detail=$5, updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [saleId, order.id, payment?.id || null, order.status || null, order.status_detail || null],
  )
  return rows[0] ? getSale(rows[0].id) : null
}

function localStatusForPoint(order) {
  if (order.status === 'processed' && (order.status_detail === 'accredited' || order.transactions?.payments?.[0]?.status_detail === 'accredited')) return 'paid'
  if (order.status === 'canceled') return 'cancelled'
  if (order.status === 'failed') return 'failed'
  if (order.status === 'expired') return 'expired'
  if (order.status === 'refunded') return 'refunded'
  return 'pending'
}

function restoreFileSale(data, sale, status, detail) {
  if (sale.inventoryApplied && ['failed', 'cancelled', 'expired'].includes(status)) {
    const now = new Date().toISOString()
    for (const line of sale.items) {
      const item = data.items.find((entry) => entry.id === line.itemId)
      if (!item) continue
      item.quantity = Number(item.quantity) + Number(line.quantity)
      item.updatedAt = now
      data.movements.unshift({
        id: crypto.randomUUID(), itemId: item.id, itemName: item.name, saleId: sale.id, type: 'stock_in',
        quantity: Number(line.quantity), balanceAfter: item.quantity,
        note: `Card sale #${shortId(sale.id)} ${status} — stock restored`, createdAt: now,
      })
    }
    sale.inventoryApplied = false
  }
  sale.status = status
  sale.mpStatus = status
  sale.mpStatusDetail = detail || status
  sale.updatedAt = new Date().toISOString()
  return normalizeSale(sale)
}

export async function markCardSaleFailed(saleId, detail = 'order_creation_failed') {
  if (!pool) return mutateFileData((data) => {
    const sale = data.sales.find((entry) => entry.id === saleId)
    return sale ? restoreFileSale(data, sale, 'failed', detail) : null
  })
  return updatePostgresSaleStatus(saleId, 'failed', 'failed', detail)
}

export async function updateSaleFromPoint(order) {
  const status = localStatusForPoint(order)
  const payment = order?.transactions?.payments?.[0]
  if (!pool) return mutateFileData((data) => {
    const sale = data.sales.find((entry) => entry.mpOrderId === order.id || `sale-${entry.id}` === order.external_reference)
    if (!sale) return null
    sale.mpOrderId = order.id || sale.mpOrderId
    sale.mpPaymentId = payment?.id || sale.mpPaymentId
    const result = restoreFileSale(data, sale, status, order.status_detail)
    sale.mpStatus = order.status
    sale.mpStatusDetail = order.status_detail
    if (status === 'paid' && !sale.paidAt) sale.paidAt = new Date().toISOString()
    return result
  })

  const lookup = order.id
    ? await pool.query('SELECT id FROM sales WHERE mp_order_id=$1 OR $2 = CONCAT(\'sale-\', id::text) LIMIT 1', [order.id, order.external_reference || ''])
    : { rows: [] }
  if (!lookup.rows[0]) return null
  const sale = await updatePostgresSaleStatus(lookup.rows[0].id, status, order.status, order.status_detail, payment?.id, order.id)
  return sale
}

async function updatePostgresSaleStatus(saleId, status, mpStatus, mpStatusDetail, mpPaymentId = null, mpOrderId = null) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const saleResult = await client.query('SELECT * FROM sales WHERE id=$1 FOR UPDATE', [saleId])
    const sale = saleResult.rows[0]
    if (!sale) { await client.query('ROLLBACK'); return null }
    if (sale.inventory_applied && ['failed', 'cancelled', 'expired'].includes(status)) {
      const itemResult = await client.query('SELECT * FROM sale_items WHERE sale_id=$1 ORDER BY item_id', [saleId])
      for (const line of itemResult.rows) {
        const updated = await client.query('UPDATE items SET quantity=quantity+$2, updated_at=NOW() WHERE id=$1 RETURNING quantity', [line.item_id, line.quantity])
        await client.query(
          `INSERT INTO movements (id, item_id, item_name, type, quantity, balance_after, note, sale_id)
           VALUES ($1,$2,$3,'stock_in',$4,$5,$6,$7)`,
          [crypto.randomUUID(), line.item_id, line.item_name, line.quantity, updated.rows[0].quantity,
            `Card sale #${shortId(saleId)} ${status} — stock restored`, saleId],
        )
      }
    }
    await client.query(
      `UPDATE sales SET status=$2, mp_status=$3, mp_status_detail=$4,
       mp_payment_id=COALESCE($5, mp_payment_id),
       mp_order_id=COALESCE($6, mp_order_id),
       inventory_applied=CASE WHEN $2 IN ('failed','cancelled','expired') THEN FALSE ELSE inventory_applied END,
       paid_at=CASE WHEN $2='paid' THEN COALESCE(paid_at,NOW()) ELSE paid_at END, updated_at=NOW()
       WHERE id=$1`,
      [saleId, status, mpStatus || status, mpStatusDetail || status, mpPaymentId, mpOrderId],
    )
    await client.query('COMMIT')
    return getSale(saleId)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function getSale(id) {
  if (!pool) {
    const data = await readFileData()
    const sale = data.sales.find((entry) => entry.id === id)
    return sale ? normalizeSale(sale) : null
  }
  const [saleResult, itemResult] = await Promise.all([
    pool.query('SELECT * FROM sales WHERE id=$1', [id]),
    pool.query('SELECT * FROM sale_items WHERE sale_id=$1 ORDER BY item_name', [id]),
  ])
  return saleResult.rows[0] ? normalizeSale(saleResult.rows[0], itemResult.rows) : null
}

export async function getSaleByPointOrder(orderId) {
  if (!pool) {
    const data = await readFileData()
    const sale = data.sales.find((entry) => entry.mpOrderId === orderId)
    return sale ? normalizeSale(sale) : null
  }
  const { rows } = await pool.query('SELECT id FROM sales WHERE mp_order_id=$1 LIMIT 1', [orderId])
  return rows[0] ? getSale(rows[0].id) : null
}

export async function listSales(limit = 50) {
  if (!pool) {
    const data = await readFileData()
    return data.sales.slice(0, limit).map((sale) => normalizeSale(sale))
  }
  const { rows } = await pool.query(`
    SELECT s.*, COALESCE(json_agg(si ORDER BY si.item_name) FILTER (WHERE si.id IS NOT NULL), '[]') AS items
    FROM sales s LEFT JOIN sale_items si ON si.sale_id=s.id
    GROUP BY s.id ORDER BY s.created_at DESC LIMIT $1
  `, [limit])
  return rows.map((row) => normalizeSale(row, row.items))
}

function saleTimestamp(sale) {
  return new Date(sale.paidAt || sale.createdAt).getTime()
}

function isWithin(sale, from, to) {
  const timestamp = saleTimestamp(sale)
  return timestamp >= from.getTime() && timestamp < to.getTime()
}

const bakeryTimeZone = process.env.BAKERY_TIME_ZONE || 'America/Santiago'
const datePartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: bakeryTimeZone, year: 'numeric', month: '2-digit', day: '2-digit',
})
const hourFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: bakeryTimeZone, hour: '2-digit', hourCycle: 'h23',
})

function localDateKey(value) {
  const parts = Object.fromEntries(datePartsFormatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function paidSummary(sales) {
  const revenue = sales.reduce((sum, sale) => sum + sale.total, 0)
  const itemsSold = sales.reduce((sum, sale) => sum + sale.items.reduce((lineSum, line) => lineSum + line.quantity, 0), 0)
  return {
    revenue,
    transactions: sales.length,
    averageTicket: sales.length ? Math.round(revenue / sales.length) : 0,
    itemsSold,
    itemsPerTransaction: sales.length ? Number((itemsSold / sales.length).toFixed(2)) : 0,
  }
}

export function buildSalesMetrics(sales, { from, to, previousFrom, previousTo, todayFrom, todayTo }) {
  const currentSales = sales.filter((sale) => isWithin(sale, from, to))
  const currentPaid = currentSales.filter((sale) => sale.status === 'paid')
  const previousPaid = sales.filter((sale) => sale.status === 'paid' && isWithin(sale, previousFrom, previousTo))
  const todayPaid = sales.filter((sale) => sale.status === 'paid' && isWithin(sale, todayFrom, todayTo))
  const summary = paidSummary(currentPaid)
  const previous = paidSummary(previousPaid)
  const cashPaid = currentPaid.filter((sale) => sale.paymentMethod === 'cash')
  const cardPaid = currentPaid.filter((sale) => sale.paymentMethod === 'card')
  const todayCash = todayPaid.filter((sale) => sale.paymentMethod === 'cash')
  const todayCard = todayPaid.filter((sale) => sale.paymentMethod === 'card')
  const dailyMap = new Map()
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, revenue: 0, transactions: 0 }))
  const products = new Map()

  for (const sale of currentPaid) {
    const day = localDateKey(sale.paidAt || sale.createdAt)
    const daily = dailyMap.get(day) || { date: day, revenue: 0, transactions: 0 }
    daily.revenue += sale.total
    daily.transactions += 1
    dailyMap.set(day, daily)

    const hour = Number(hourFormatter.format(new Date(sale.paidAt || sale.createdAt)))
    if (hourly[hour]) {
      hourly[hour].revenue += sale.total
      hourly[hour].transactions += 1
    }

    for (const line of sale.items) {
      const key = line.itemId || line.name
      const product = products.get(key) || { itemId: line.itemId || null, name: line.name, quantity: 0, revenue: 0 }
      product.quantity += line.quantity
      product.revenue += line.lineTotal
      products.set(key, product)
    }
  }

  const topProducts = [...products.values()]
    .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)
    .slice(0, 8)
    .map((product) => ({ ...product, revenueShare: summary.revenue ? Number(((product.revenue / summary.revenue) * 100).toFixed(1)) : 0 }))

  return {
    summary: {
      ...summary,
      previousRevenue: previous.revenue,
      revenueChangePct: previous.revenue > 0 ? Number((((summary.revenue - previous.revenue) / previous.revenue) * 100).toFixed(1)) : null,
      pendingPoint: currentSales.filter((sale) => sale.paymentMethod === 'card' && sale.status === 'pending').length,
      failedPayments: currentSales.filter((sale) => ['failed', 'cancelled', 'expired'].includes(sale.status)).length,
      refundedTotal: currentSales.filter((sale) => sale.status === 'refunded').reduce((sum, sale) => sum + sale.total, 0),
    },
    paymentMethods: {
      cash: paidSummary(cashPaid),
      card: paidSummary(cardPaid),
    },
    daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    hourly,
    topProducts,
    today: {
      ...paidSummary(todayPaid),
      cashRevenue: paidSummary(todayCash).revenue,
      cashTransactions: todayCash.length,
      cardRevenue: paidSummary(todayCard).revenue,
      cardTransactions: todayCard.length,
    },
  }
}

async function listSalesBetween(from, to) {
  if (!pool) {
    const data = await readFileData()
    return data.sales.map((sale) => normalizeSale(sale)).filter((sale) => isWithin(sale, from, to))
  }
  const { rows } = await pool.query(`
    SELECT s.*, COALESCE(json_agg(si ORDER BY si.item_name) FILTER (WHERE si.id IS NOT NULL), '[]') AS items
    FROM sales s LEFT JOIN sale_items si ON si.sale_id=s.id
    WHERE COALESCE(s.paid_at, s.created_at) >= $1 AND COALESCE(s.paid_at, s.created_at) < $2
    GROUP BY s.id ORDER BY s.created_at DESC
  `, [from.toISOString(), to.toISOString()])
  return rows.map((row) => normalizeSale(row, row.items))
}

export async function getCashClosure(businessDate) {
  if (!pool) {
    const data = await readFileData()
    return normalizeCashClosure(data.cashClosures.find((closure) => closure.businessDate === businessDate))
  }
  const { rows } = await pool.query('SELECT * FROM cash_closures WHERE business_date=$1 LIMIT 1', [businessDate])
  return normalizeCashClosure(rows[0])
}

export async function getSalesMetrics(period) {
  const earliest = new Date(Math.min(period.from.getTime(), period.previousFrom.getTime(), period.todayFrom.getTime()))
  const latest = new Date(Math.max(period.to.getTime(), period.previousTo.getTime(), period.todayTo.getTime()))
  const sales = await listSalesBetween(earliest, latest)
  const metrics = buildSalesMetrics(sales, period)
  return { ...metrics, cashClosure: await getCashClosure(period.businessDate) }
}

function closureSnapshot(sales, input) {
  const paid = sales.filter((sale) => sale.status === 'paid')
  const cashSales = paid.filter((sale) => sale.paymentMethod === 'cash').reduce((sum, sale) => sum + sale.total, 0)
  const cardSales = paid.filter((sale) => sale.paymentMethod === 'card').reduce((sum, sale) => sum + sale.total, 0)
  const totalSales = cashSales + cardSales
  const expectedCash = input.openingCash + cashSales + input.cashAdjustments
  return {
    id: input.id || crypto.randomUUID(), businessDate: input.businessDate,
    openingCash: input.openingCash, cashAdjustments: input.cashAdjustments, countedCash: input.countedCash,
    cashSales, cardSales, totalSales, expectedCash, difference: input.countedCash - expectedCash,
    transactionCount: paid.length, note: input.note, closedAt: new Date().toISOString(),
  }
}

export async function saveCashClosure(input, todayFrom, todayTo) {
  if (!pool) {
    return mutateFileData((data) => {
      const todaySales = data.sales.map((sale) => normalizeSale(sale)).filter((sale) => isWithin(sale, todayFrom, todayTo))
      const existingIndex = data.cashClosures.findIndex((closure) => closure.businessDate === input.businessDate)
      const closure = closureSnapshot(todaySales, { ...input, id: existingIndex >= 0 ? data.cashClosures[existingIndex].id : null })
      if (existingIndex >= 0) data.cashClosures[existingIndex] = closure
      else data.cashClosures.unshift(closure)
      return normalizeCashClosure(closure)
    })
  }

  const todaySales = await listSalesBetween(todayFrom, todayTo)
  const closure = closureSnapshot(todaySales, input)
  const { rows } = await pool.query(`
    INSERT INTO cash_closures (
      id, business_date, opening_cash, cash_adjustments, counted_cash, cash_sales, card_sales,
      total_sales, expected_cash, difference, transaction_count, note, closed_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (business_date) DO UPDATE SET
      opening_cash=EXCLUDED.opening_cash, cash_adjustments=EXCLUDED.cash_adjustments,
      counted_cash=EXCLUDED.counted_cash, cash_sales=EXCLUDED.cash_sales,
      card_sales=EXCLUDED.card_sales, total_sales=EXCLUDED.total_sales,
      expected_cash=EXCLUDED.expected_cash, difference=EXCLUDED.difference,
      transaction_count=EXCLUDED.transaction_count, note=EXCLUDED.note, closed_at=EXCLUDED.closed_at
    RETURNING *
  `, [
    closure.id, closure.businessDate, closure.openingCash, closure.cashAdjustments, closure.countedCash,
    closure.cashSales, closure.cardSales, closure.totalSales, closure.expectedCash, closure.difference,
    closure.transactionCount, closure.note, closure.closedAt,
  ])
  return normalizeCashClosure(rows[0])
}

export async function listMovements(limit = 50) {
  if (pool) {
    const { rows } = await pool.query('SELECT * FROM movements ORDER BY created_at DESC LIMIT $1', [limit])
    return rows.map(normalizeMovement)
  }
  const data = await readFileData()
  return data.movements.slice(0, limit).map(normalizeMovement)
}

export async function closeStore() {
  if (pool) await pool.end()
}
