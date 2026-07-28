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
    expiryDate: row.expiry_date ?? row.expiryDate ?? null,
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

function ensureFileShape(data) {
  data.items ||= []
  data.movements ||= []
  data.sales ||= []
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
    `)
    return
  }

  await fs.mkdir(path.dirname(dataPath), { recursive: true })
  try {
    await fs.access(dataPath)
    const data = ensureFileShape(await readFileData())
    await fs.writeFile(dataPath, JSON.stringify(data, null, 2))
  } catch {
    const data = { items: [], movements: [], sales: [] }
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
