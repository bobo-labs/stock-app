import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
const dataPath = process.env.DATA_PATH || path.join(process.cwd(), 'data', 'inventory.json')
let pool = null
let fileQueue = Promise.resolve()

const demoItems = [
  { name: 'Butter croissant', category: 'Pastries', unit: 'pieces', quantity: 28, lowStockThreshold: 10, sku: 'PAS-001', expiryDate: tomorrow(1) },
  { name: 'Sourdough loaf', category: 'Bread', unit: 'loaves', quantity: 8, lowStockThreshold: 8, sku: 'BRD-001', expiryDate: tomorrow(2) },
  { name: 'Chocolate éclair', category: 'Pastries', unit: 'pieces', quantity: 5, lowStockThreshold: 8, sku: 'PAS-004', expiryDate: tomorrow(1) },
  { name: 'All-purpose flour', category: 'Ingredients', unit: 'kg', quantity: 42, lowStockThreshold: 15, sku: 'ING-001', expiryDate: tomorrow(90) },
  { name: 'Cake boxes', category: 'Packaging', unit: 'boxes', quantity: 12, lowStockThreshold: 20, sku: 'PKG-003', expiryDate: null },
]

function tomorrow(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
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
    expiryDate: row.expiry_date ?? row.expiryDate ?? null,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  }
}

function normalizeMovement(row) {
  return {
    id: row.id,
    itemId: row.item_id ?? row.itemId,
    itemName: row.item_name ?? row.itemName,
    type: row.type,
    quantity: Number(row.quantity),
    balanceAfter: Number(row.balance_after ?? row.balanceAfter),
    note: row.note || '',
    createdAt: row.created_at ?? row.createdAt,
  }
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
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS movements (
        id UUID PRIMARY KEY,
        item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        item_name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('stock_in', 'stock_out', 'adjustment')),
        quantity NUMERIC(12,2) NOT NULL,
        balance_after NUMERIC(12,2) NOT NULL CHECK (balance_after >= 0),
        note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS movements_created_at_idx ON movements(created_at DESC);
    `)
    return
  }

  await fs.mkdir(path.dirname(dataPath), { recursive: true })
  try {
    await fs.access(dataPath)
  } catch {
    const data = { items: [], movements: [] }
    if (process.env.SEED_DEMO_DATA === 'true') {
      for (const item of demoItems) addItemToData(data, item)
    }
    await fs.writeFile(dataPath, JSON.stringify(data, null, 2))
  }
}

async function readFileData() {
  return JSON.parse(await fs.readFile(dataPath, 'utf8'))
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
    createdAt: now,
    updatedAt: now,
  }
  data.items.push(item)
  if (item.quantity > 0) {
    data.movements.unshift({
      id: crypto.randomUUID(), itemId: item.id, itemName: item.name, type: 'stock_in',
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
  return data.items.sort((a, b) => a.name.localeCompare(b.name))
}

export async function createItem(input) {
  if (!pool) return mutateFileData((data) => addItemToData(data, input))

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const id = crypto.randomUUID()
    const { rows } = await client.query(
      `INSERT INTO items (id, name, category, unit, quantity, low_stock_threshold, sku, expiry_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, input.name, input.category, input.unit, input.quantity, input.lowStockThreshold, input.sku, input.expiryDate || null],
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
      return item
    })
  }
  const { rows } = await pool.query(
    `UPDATE items SET name=$2, category=$3, unit=$4, low_stock_threshold=$5, sku=$6,
     expiry_date=$7, updated_at=NOW() WHERE id=$1 RETURNING *`,
    [id, input.name, input.category, input.unit, input.lowStockThreshold, input.sku, input.expiryDate || null],
  )
  return rows[0] ? normalizeItem(rows[0]) : null
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
        id: crypto.randomUUID(), itemId: item.id, itemName: item.name, type: input.type,
        quantity: delta, balanceAfter: next, note: input.note || '', createdAt: item.updatedAt,
      })
      return item
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

export async function listMovements(limit = 50) {
  if (pool) {
    const { rows } = await pool.query('SELECT * FROM movements ORDER BY created_at DESC LIMIT $1', [limit])
    return rows.map(normalizeMovement)
  }
  const data = await readFileData()
  return data.movements.slice(0, limit)
}

export async function closeStore() {
  if (pool) await pool.end()
}
