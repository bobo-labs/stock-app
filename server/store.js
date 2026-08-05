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

function normalizeCreditNote(row) {
  if (!row) return null
  return {
    id: row.id,
    status: row.status,
    mode: row.mode || 'manual',
    originalDocumentType: row.original_document_type ?? row.originalDocumentType ?? '',
    originalFolio: row.original_folio ?? row.originalFolio ?? '',
    folio: row.folio || '',
    siiTrackId: row.sii_track_id ?? row.siiTrackId ?? '',
    errorDetail: row.error_detail ?? row.errorDetail ?? '',
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
    issuedAt: row.issued_at ?? row.issuedAt ?? null,
  }
}

function normalizeRefund(row, items = row.items || [], creditNote = row.creditNote || row.credit_note || null) {
  return {
    id: row.id,
    saleId: row.sale_id ?? row.saleId,
    status: row.status,
    amount: Number(row.amount),
    reason: row.reason || '',
    restock: Boolean(row.restock),
    creditNoteRequired: Boolean(row.credit_note_required ?? row.creditNoteRequired),
    originalDocumentType: row.original_document_type ?? row.originalDocumentType ?? '',
    originalFolio: row.original_folio ?? row.originalFolio ?? '',
    mpRefundId: row.mp_refund_id ?? row.mpRefundId ?? null,
    mpStatus: row.mp_status ?? row.mpStatus ?? null,
    errorDetail: row.error_detail ?? row.errorDetail ?? '',
    items: items.map((item) => ({
      lineId: item.sale_item_id ?? item.lineId,
      itemId: item.item_id ?? item.itemId ?? null,
      name: item.item_name ?? item.name,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price ?? item.unitPrice),
      lineTotal: Number(item.line_total ?? item.lineTotal),
      restocked: Boolean(item.restocked),
    })),
    creditNote: normalizeCreditNote(creditNote),
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
    processedAt: row.processed_at ?? row.processedAt ?? null,
  }
}

function normalizeSale(row, items = row.items || [], refunds = row.refunds || []) {
  const normalizedRefunds = refunds.map((refund) => normalizeRefund(refund, refund.items, refund.creditNote || refund.credit_note))
  const refundedTotal = normalizedRefunds
    .filter((refund) => refund.status === 'processed')
    .reduce((sum, refund) => sum + refund.amount, 0)
  return {
    id: row.id,
    shortId: shortId(row.id),
    status: row.status,
    paymentMethod: row.payment_method ?? row.paymentMethod,
    total: Number(row.total),
    items: items.map((item) => ({
      lineId: item.id ?? item.line_id ?? item.lineId,
      itemId: item.item_id ?? item.itemId,
      name: item.item_name ?? item.name,
      unit: item.unit,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price ?? item.unitPrice),
      lineTotal: Number(item.line_total ?? item.lineTotal),
    })),
    refunds: normalizedRefunds,
    refundedTotal,
    refundableTotal: Math.max(Number(row.total) - refundedTotal, 0),
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
  for (const sale of data.sales) {
    sale.refunds ||= []
    for (const line of sale.items || []) line.lineId ||= crypto.randomUUID()
    for (const refund of sale.refunds) {
      refund.items ||= []
      refund.creditNote ||= null
    }
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
      CREATE TABLE IF NOT EXISTS refunds (
        id UUID PRIMARY KEY,
        sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('pending','processed','failed')),
        amount NUMERIC(12,0) NOT NULL CHECK (amount > 0),
        reason TEXT NOT NULL DEFAULT '',
        restock BOOLEAN NOT NULL DEFAULT TRUE,
        credit_note_required BOOLEAN NOT NULL DEFAULT FALSE,
        original_document_type TEXT NOT NULL DEFAULT '',
        original_folio TEXT NOT NULL DEFAULT '',
        mp_refund_id TEXT UNIQUE,
        mp_status TEXT,
        error_detail TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS refund_items (
        id UUID PRIMARY KEY,
        refund_id UUID NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
        sale_item_id UUID REFERENCES sale_items(id) ON DELETE SET NULL,
        item_id UUID REFERENCES items(id) ON DELETE SET NULL,
        item_name TEXT NOT NULL,
        quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
        unit_price NUMERIC(12,0) NOT NULL CHECK (unit_price >= 0),
        line_total NUMERIC(12,0) NOT NULL CHECK (line_total >= 0),
        restocked BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE TABLE IF NOT EXISTS tax_documents (
        id UUID PRIMARY KEY,
        sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        refund_id UUID NOT NULL UNIQUE REFERENCES refunds(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('credit_note')),
        status TEXT NOT NULL CHECK (status IN ('pending','issued','failed')),
        mode TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual','sii_own')),
        original_document_type TEXT NOT NULL DEFAULT '',
        original_folio TEXT NOT NULL DEFAULT '',
        folio TEXT NOT NULL DEFAULT '',
        sii_track_id TEXT NOT NULL DEFAULT '',
        error_detail TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        issued_at TIMESTAMPTZ
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
      CREATE INDEX IF NOT EXISTS refunds_sale_id_idx ON refunds(sale_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS refund_items_refund_id_idx ON refund_items(refund_id);
      CREATE INDEX IF NOT EXISTS tax_documents_sale_id_idx ON tax_documents(sale_id, created_at DESC);
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
    items: lines.map(({ item, quantity, unitPrice, lineTotal }) => ({ lineId: crypto.randomUUID(), itemId: item.id, name: item.name, unit: item.unit, quantity, unitPrice, lineTotal })),
    refunds: [],
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
    const persistedLines = lines.map((line) => ({ ...line, lineId: crypto.randomUUID() }))
    for (const line of persistedLines) {
      await client.query(
        `INSERT INTO sale_items (id, sale_id, item_id, item_name, unit, quantity, unit_price, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [line.lineId, id, line.item.id, line.item.name, line.item.unit, line.quantity, line.unitPrice, line.lineTotal],
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
    return normalizeSale(saleResult.rows[0], persistedLines.map((line) => ({
      id: line.lineId, item_id: line.item.id, item_name: line.item.name, unit: line.item.unit,
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
  if (order.status === 'processed' && ['accredited', 'partially_refunded'].includes(order.status_detail)) return 'paid'
  if (order.status === 'processed' && ['accredited', 'partially_refunded'].includes(order.transactions?.payments?.[0]?.status_detail)) return 'paid'
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

function refundConflict(message) {
  return Object.assign(new Error(message), { status: 409 })
}

function refundLinesForSale(sale, requested) {
  if (sale.status !== 'paid') throw refundConflict('Only an approved sale can be refunded.')
  if (sale.refunds.some((refund) => refund.status === 'pending')) throw refundConflict('This sale already has a refund in progress.')
  if (sale.refundableTotal <= 0) throw refundConflict('This sale has already been refunded in full.')

  const refundedByLine = new Map()
  for (const refund of sale.refunds.filter((entry) => entry.status === 'processed')) {
    for (const line of refund.items) refundedByLine.set(line.lineId, (refundedByLine.get(line.lineId) || 0) + line.quantity)
  }
  const saleLines = new Map(sale.items.map((line) => [line.lineId, line]))
  const combined = new Map()
  for (const line of requested) combined.set(line.lineId, (combined.get(line.lineId) || 0) + Number(line.quantity))
  const lines = [...combined.entries()].map(([lineId, quantity]) => {
    const saleLine = saleLines.get(lineId)
    if (!saleLine) throw Object.assign(new Error('One of the selected sale lines no longer exists.'), { status: 400 })
    const remaining = Number(saleLine.quantity) - Number(refundedByLine.get(lineId) || 0)
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > remaining) {
      throw Object.assign(new Error(`The refundable quantity for ${saleLine.name} is ${remaining}.`), { status: 400 })
    }
    return {
      lineId,
      itemId: saleLine.itemId || null,
      name: saleLine.name,
      quantity,
      unitPrice: saleLine.unitPrice,
      lineTotal: Math.round(saleLine.unitPrice * quantity),
      restocked: false,
    }
  })
  const amount = lines.reduce((sum, line) => sum + line.lineTotal, 0)
  if (!lines.length || amount <= 0 || amount > sale.refundableTotal) throw Object.assign(new Error('Select at least one refundable product.'), { status: 400 })
  return { lines, amount, full: sale.refundedTotal + amount >= sale.total }
}

function refundInputRecord(saleId, input, calculated) {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    saleId,
    status: 'pending',
    amount: calculated.amount,
    reason: input.reason,
    restock: input.restock,
    creditNoteRequired: input.creditNoteRequired,
    originalDocumentType: input.originalDocumentType,
    originalFolio: input.originalFolio,
    mpRefundId: null,
    mpStatus: null,
    errorDetail: '',
    items: calculated.lines,
    creditNote: null,
    createdAt: now,
    updatedAt: now,
    processedAt: null,
  }
}

export async function prepareRefund(saleId, input) {
  if (!pool) {
    return mutateFileData((data) => {
      const storedSale = data.sales.find((entry) => entry.id === saleId)
      if (!storedSale) return null
      const sale = normalizeSale(storedSale)
      const calculated = refundLinesForSale(sale, input.items)
      const refund = refundInputRecord(saleId, input, calculated)
      storedSale.refunds.unshift(refund)
      storedSale.updatedAt = refund.updatedAt
      return { sale: normalizeSale(storedSale), refund: normalizeRefund(refund), full: calculated.full }
    })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const saleResult = await client.query('SELECT * FROM sales WHERE id=$1 FOR UPDATE', [saleId])
    if (!saleResult.rows[0]) { await client.query('ROLLBACK'); return null }
    const [itemResult, refundResult, refundItemResult, creditNoteResult] = await Promise.all([
      client.query('SELECT * FROM sale_items WHERE sale_id=$1 ORDER BY item_name', [saleId]),
      client.query('SELECT * FROM refunds WHERE sale_id=$1 ORDER BY created_at DESC FOR UPDATE', [saleId]),
      client.query(`SELECT ri.* FROM refund_items ri JOIN refunds r ON r.id=ri.refund_id WHERE r.sale_id=$1`, [saleId]),
      client.query('SELECT * FROM tax_documents WHERE sale_id=$1', [saleId]),
    ])
    const itemsByRefund = new Map()
    for (const item of refundItemResult.rows) {
      const entries = itemsByRefund.get(item.refund_id) || []
      entries.push(item)
      itemsByRefund.set(item.refund_id, entries)
    }
    const creditNoteByRefund = new Map(creditNoteResult.rows.map((document) => [document.refund_id, document]))
    const refunds = refundResult.rows.map((refund) => ({
      ...refund,
      items: itemsByRefund.get(refund.id) || [],
      creditNote: creditNoteByRefund.get(refund.id) || null,
    }))
    const sale = normalizeSale(saleResult.rows[0], itemResult.rows, refunds)
    const calculated = refundLinesForSale(sale, input.items)
    const refund = refundInputRecord(saleId, input, calculated)
    await client.query(
      `INSERT INTO refunds (
        id, sale_id, status, amount, reason, restock, credit_note_required,
        original_document_type, original_folio, created_at, updated_at
      ) VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9,$9)`,
      [refund.id, saleId, refund.amount, refund.reason, refund.restock, refund.creditNoteRequired,
        refund.originalDocumentType, refund.originalFolio, refund.createdAt],
    )
    for (const line of refund.items) {
      await client.query(
        `INSERT INTO refund_items (
          id, refund_id, sale_item_id, item_id, item_name, quantity, unit_price, line_total, restocked
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE)`,
        [crypto.randomUUID(), refund.id, line.lineId, line.itemId, line.name, line.quantity, line.unitPrice, line.lineTotal],
      )
    }
    await client.query('COMMIT')
    const hydrated = await getSale(saleId)
    return { sale: hydrated, refund: hydrated.refunds.find((entry) => entry.id === refund.id), full: calculated.full }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function pointRefundIdentifier(order) {
  const refunds = order?.transactions?.refunds || []
  return refunds.at(-1)?.id || null
}

export async function completeRefund(refundId, order = null) {
  const mpRefundId = pointRefundIdentifier(order)
  const mpStatus = order?.transactions?.refunds?.at(-1)?.status || order?.status || 'processed'
  if (!pool) {
    return mutateFileData((data) => {
      const sale = data.sales.find((entry) => entry.refunds.some((refund) => refund.id === refundId))
      if (!sale) return null
      const refund = sale.refunds.find((entry) => entry.id === refundId)
      if (refund.status === 'processed') return normalizeSale(sale)
      if (refund.status !== 'pending') throw refundConflict('This refund can no longer be completed.')
      const now = new Date().toISOString()
      if (refund.restock) {
        for (const line of refund.items) {
          const item = data.items.find((entry) => entry.id === line.itemId)
          if (!item) continue
          item.quantity = Number(item.quantity) + Number(line.quantity)
          item.updatedAt = now
          line.restocked = true
          data.movements.unshift({
            id: crypto.randomUUID(), itemId: item.id, itemName: item.name, saleId: sale.id, type: 'stock_in',
            quantity: Number(line.quantity), balanceAfter: item.quantity,
            note: `Refund #${shortId(refund.id)} — stock restored`, createdAt: now,
          })
        }
      }
      Object.assign(refund, { status: 'processed', mpRefundId, mpStatus, errorDetail: '', updatedAt: now, processedAt: now })
      if (refund.creditNoteRequired) {
        refund.creditNote = {
          id: crypto.randomUUID(), status: 'pending', mode: 'manual',
          originalDocumentType: refund.originalDocumentType, originalFolio: refund.originalFolio,
          folio: '', siiTrackId: '', errorDetail: '', createdAt: now, updatedAt: now, issuedAt: null,
        }
      }
      const refundedTotal = sale.refunds.filter((entry) => entry.status === 'processed').reduce((sum, entry) => sum + Number(entry.amount), 0)
      sale.status = refundedTotal >= Number(sale.total) ? 'refunded' : 'paid'
      if (order) {
        sale.mpStatus = order.status || sale.mpStatus
        sale.mpStatusDetail = order.status_detail || sale.mpStatusDetail
      }
      sale.updatedAt = now
      return normalizeSale(sale)
    })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const refundResult = await client.query('SELECT * FROM refunds WHERE id=$1 FOR UPDATE', [refundId])
    const refund = refundResult.rows[0]
    if (!refund) { await client.query('ROLLBACK'); return null }
    if (refund.status === 'processed') { await client.query('COMMIT'); return getSale(refund.sale_id) }
    if (refund.status !== 'pending') throw refundConflict('This refund can no longer be completed.')
    const saleResult = await client.query('SELECT * FROM sales WHERE id=$1 FOR UPDATE', [refund.sale_id])
    const sale = saleResult.rows[0]
    const itemResult = await client.query('SELECT * FROM refund_items WHERE refund_id=$1 ORDER BY item_name FOR UPDATE', [refundId])
    if (refund.restock) {
      for (const line of itemResult.rows) {
        if (!line.item_id) continue
        const updated = await client.query('UPDATE items SET quantity=quantity+$2, updated_at=NOW() WHERE id=$1 RETURNING quantity,name', [line.item_id, line.quantity])
        if (!updated.rows[0]) continue
        await client.query('UPDATE refund_items SET restocked=TRUE WHERE id=$1', [line.id])
        await client.query(
          `INSERT INTO movements (id, item_id, item_name, type, quantity, balance_after, note, sale_id)
           VALUES ($1,$2,$3,'stock_in',$4,$5,$6,$7)`,
          [crypto.randomUUID(), line.item_id, line.item_name, line.quantity, updated.rows[0].quantity,
            `Refund #${shortId(refundId)} — stock restored`, refund.sale_id],
        )
      }
    }
    await client.query(
      `UPDATE refunds SET status='processed', mp_refund_id=$2, mp_status=$3, error_detail='',
       processed_at=NOW(), updated_at=NOW() WHERE id=$1`,
      [refundId, mpRefundId, mpStatus],
    )
    if (refund.credit_note_required) {
      await client.query(
        `INSERT INTO tax_documents (
          id, sale_id, refund_id, type, status, mode, original_document_type, original_folio
        ) VALUES ($1,$2,$3,'credit_note','pending','manual',$4,$5)
        ON CONFLICT (refund_id) DO NOTHING`,
        [crypto.randomUUID(), refund.sale_id, refundId, refund.original_document_type, refund.original_folio],
      )
    }
    const totalResult = await client.query(
      `SELECT COALESCE(SUM(amount),0) AS total FROM refunds WHERE sale_id=$1 AND status='processed'`,
      [refund.sale_id],
    )
    const fullyRefunded = Number(totalResult.rows[0].total) >= Number(sale.total)
    await client.query(
      `UPDATE sales SET status=$2, mp_status=COALESCE($3,mp_status), mp_status_detail=COALESCE($4,mp_status_detail), updated_at=NOW() WHERE id=$1`,
      [refund.sale_id, fullyRefunded ? 'refunded' : 'paid', order?.status || null, order?.status_detail || null],
    )
    await client.query('COMMIT')
    return getSale(refund.sale_id)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function failRefund(refundId, detail) {
  const message = String(detail || 'refund_failed').slice(0, 500)
  if (!pool) {
    return mutateFileData((data) => {
      const sale = data.sales.find((entry) => entry.refunds.some((refund) => refund.id === refundId))
      if (!sale) return null
      const refund = sale.refunds.find((entry) => entry.id === refundId)
      if (refund.status === 'pending') Object.assign(refund, { status: 'failed', errorDetail: message, updatedAt: new Date().toISOString() })
      return normalizeSale(sale)
    })
  }
  const { rows } = await pool.query(
    `UPDATE refunds SET status='failed', error_detail=$2, updated_at=NOW() WHERE id=$1 AND status='pending' RETURNING sale_id`,
    [refundId, message],
  )
  return rows[0] ? getSale(rows[0].sale_id) : null
}

export async function recordCreditNote(saleId, refundId, input) {
  if (!pool) {
    return mutateFileData((data) => {
      const sale = data.sales.find((entry) => entry.id === saleId)
      const refund = sale?.refunds.find((entry) => entry.id === refundId)
      if (!refund || refund.status !== 'processed') return null
      const now = new Date().toISOString()
      refund.creditNote = {
        ...(refund.creditNote || { id: crypto.randomUUID(), createdAt: now }),
        status: 'issued', mode: 'manual', originalDocumentType: input.originalDocumentType,
        originalFolio: input.originalFolio, folio: input.folio, siiTrackId: input.siiTrackId,
        errorDetail: '', updatedAt: now, issuedAt: now,
      }
      refund.creditNoteRequired = true
      return normalizeSale(sale)
    })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const refundResult = await client.query('SELECT * FROM refunds WHERE id=$1 AND sale_id=$2 AND status=\'processed\' FOR UPDATE', [refundId, saleId])
    if (!refundResult.rows[0]) { await client.query('ROLLBACK'); return null }
    await client.query(
      `INSERT INTO tax_documents (
        id, sale_id, refund_id, type, status, mode, original_document_type, original_folio,
        folio, sii_track_id, issued_at, updated_at
      ) VALUES ($1,$2,$3,'credit_note','issued','manual',$4,$5,$6,$7,NOW(),NOW())
      ON CONFLICT (refund_id) DO UPDATE SET
        status='issued', mode='manual', original_document_type=EXCLUDED.original_document_type,
        original_folio=EXCLUDED.original_folio, folio=EXCLUDED.folio,
        sii_track_id=EXCLUDED.sii_track_id, error_detail='', issued_at=NOW(), updated_at=NOW()`,
      [crypto.randomUUID(), saleId, refundId, input.originalDocumentType, input.originalFolio, input.folio, input.siiTrackId],
    )
    await client.query(
      `UPDATE refunds SET credit_note_required=TRUE, original_document_type=$2, original_folio=$3, updated_at=NOW() WHERE id=$1`,
      [refundId, input.originalDocumentType, input.originalFolio],
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

async function hydratePostgresSales(rows) {
  if (!rows.length) return []
  const saleIds = rows.map((row) => row.id)
  const [itemResult, refundResult, taxDocumentResult] = await Promise.all([
    pool.query('SELECT * FROM sale_items WHERE sale_id = ANY($1::uuid[]) ORDER BY item_name', [saleIds]),
    pool.query('SELECT * FROM refunds WHERE sale_id = ANY($1::uuid[]) ORDER BY created_at DESC', [saleIds]),
    pool.query('SELECT * FROM tax_documents WHERE sale_id = ANY($1::uuid[]) ORDER BY created_at DESC', [saleIds]),
  ])
  const refundIds = refundResult.rows.map((refund) => refund.id)
  const refundItemResult = refundIds.length
    ? await pool.query('SELECT * FROM refund_items WHERE refund_id = ANY($1::uuid[]) ORDER BY item_name', [refundIds])
    : { rows: [] }

  const itemsBySale = new Map(saleIds.map((id) => [id, []]))
  const refundsBySale = new Map(saleIds.map((id) => [id, []]))
  const itemsByRefund = new Map(refundIds.map((id) => [id, []]))
  const creditNoteByRefund = new Map(taxDocumentResult.rows.map((document) => [document.refund_id, document]))
  for (const item of itemResult.rows) itemsBySale.get(item.sale_id)?.push(item)
  for (const item of refundItemResult.rows) itemsByRefund.get(item.refund_id)?.push(item)
  for (const refund of refundResult.rows) {
    refundsBySale.get(refund.sale_id)?.push({
      ...refund,
      items: itemsByRefund.get(refund.id) || [],
      creditNote: creditNoteByRefund.get(refund.id) || null,
    })
  }
  return rows.map((row) => normalizeSale(row, itemsBySale.get(row.id) || [], refundsBySale.get(row.id) || []))
}

export async function getSale(id) {
  if (!pool) {
    const data = await readFileData()
    const sale = data.sales.find((entry) => entry.id === id)
    return sale ? normalizeSale(sale) : null
  }
  const saleResult = await pool.query('SELECT * FROM sales WHERE id=$1', [id])
  return saleResult.rows[0] ? (await hydratePostgresSales(saleResult.rows))[0] : null
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
  const { rows } = await pool.query('SELECT * FROM sales ORDER BY created_at DESC LIMIT $1', [limit])
  return hydratePostgresSales(rows)
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

function completedSale(sale) {
  return sale.status === 'paid' || sale.status === 'refunded'
}

function refundTimestamp(refund) {
  return new Date(refund.processedAt || refund.updatedAt || refund.createdAt).getTime()
}

function refundIsWithin(refund, from, to) {
  const timestamp = refundTimestamp(refund)
  return refund.status === 'processed' && timestamp >= from.getTime() && timestamp < to.getTime()
}

function refundsWithin(sales, from, to) {
  return sales.flatMap((sale) => sale.refunds
    .filter((refund) => refundIsWithin(refund, from, to))
    .map((refund) => ({ ...refund, paymentMethod: sale.paymentMethod, saleId: sale.id })))
}

function paidSummary(sales, refunds = []) {
  const grossRevenue = sales.reduce((sum, sale) => sum + sale.total, 0)
  const refundedTotal = refunds.reduce((sum, refund) => sum + refund.amount, 0)
  const revenue = grossRevenue - refundedTotal
  const soldItems = sales.reduce((sum, sale) => sum + sale.items.reduce((lineSum, line) => lineSum + line.quantity, 0), 0)
  const refundedItems = refunds.reduce((sum, refund) => sum + refund.items.reduce((lineSum, line) => lineSum + line.quantity, 0), 0)
  const itemsSold = soldItems - refundedItems
  return {
    revenue,
    grossRevenue,
    refundedTotal,
    transactions: sales.length,
    averageTicket: sales.length ? Math.round(revenue / sales.length) : 0,
    itemsSold,
    itemsPerTransaction: sales.length ? Number((itemsSold / sales.length).toFixed(2)) : 0,
  }
}

export function buildSalesMetrics(sales, { from, to, previousFrom, previousTo, todayFrom, todayTo }) {
  const currentSales = sales.filter((sale) => isWithin(sale, from, to))
  const currentPaid = currentSales.filter(completedSale)
  const previousPaid = sales.filter((sale) => completedSale(sale) && isWithin(sale, previousFrom, previousTo))
  const todayPaid = sales.filter((sale) => completedSale(sale) && isWithin(sale, todayFrom, todayTo))
  const currentRefunds = refundsWithin(sales, from, to)
  const previousRefunds = refundsWithin(sales, previousFrom, previousTo)
  const todayRefunds = refundsWithin(sales, todayFrom, todayTo)
  const summary = paidSummary(currentPaid, currentRefunds)
  const previous = paidSummary(previousPaid, previousRefunds)
  const cashPaid = currentPaid.filter((sale) => sale.paymentMethod === 'cash')
  const cardPaid = currentPaid.filter((sale) => sale.paymentMethod === 'card')
  const cashRefunds = currentRefunds.filter((refund) => refund.paymentMethod === 'cash')
  const cardRefunds = currentRefunds.filter((refund) => refund.paymentMethod === 'card')
  const todayCash = todayPaid.filter((sale) => sale.paymentMethod === 'cash')
  const todayCard = todayPaid.filter((sale) => sale.paymentMethod === 'card')
  const todayCashRefunds = todayRefunds.filter((refund) => refund.paymentMethod === 'cash')
  const todayCardRefunds = todayRefunds.filter((refund) => refund.paymentMethod === 'card')
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

  for (const refund of currentRefunds) {
    const timestamp = refund.processedAt || refund.updatedAt || refund.createdAt
    const day = localDateKey(timestamp)
    const daily = dailyMap.get(day) || { date: day, revenue: 0, transactions: 0 }
    daily.revenue -= refund.amount
    dailyMap.set(day, daily)

    const hour = Number(hourFormatter.format(new Date(timestamp)))
    if (hourly[hour]) hourly[hour].revenue -= refund.amount

    for (const line of refund.items) {
      const key = line.itemId || line.name
      const product = products.get(key) || { itemId: line.itemId || null, name: line.name, quantity: 0, revenue: 0 }
      product.quantity -= line.quantity
      product.revenue -= line.lineTotal
      products.set(key, product)
    }
  }

  const topProducts = [...products.values()]
    .filter((product) => product.quantity > 0 || product.revenue > 0)
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
      refundedTotal: currentRefunds.reduce((sum, refund) => sum + refund.amount, 0),
    },
    paymentMethods: {
      cash: paidSummary(cashPaid, cashRefunds),
      card: paidSummary(cardPaid, cardRefunds),
    },
    daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    hourly,
    topProducts,
    today: {
      ...paidSummary(todayPaid, todayRefunds),
      cashRevenue: paidSummary(todayCash, todayCashRefunds).revenue,
      cashTransactions: todayCash.length,
      cardRevenue: paidSummary(todayCard, todayCardRefunds).revenue,
      cardTransactions: todayCard.length,
    },
  }
}

async function listSalesBetween(from, to) {
  if (!pool) {
    const data = await readFileData()
    return data.sales.map((sale) => normalizeSale(sale)).filter((sale) => (
      isWithin(sale, from, to) || sale.refunds.some((refund) => refundIsWithin(refund, from, to))
    ))
  }
  const { rows } = await pool.query(`
    SELECT s.* FROM sales s
    WHERE (COALESCE(s.paid_at, s.created_at) >= $1 AND COALESCE(s.paid_at, s.created_at) < $2)
       OR EXISTS (
         SELECT 1 FROM refunds r
         WHERE r.sale_id=s.id AND r.status='processed' AND r.processed_at >= $1 AND r.processed_at < $2
       )
    ORDER BY s.created_at DESC
  `, [from.toISOString(), to.toISOString()])
  return hydratePostgresSales(rows)
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

function closureSnapshot(sales, input, from, to) {
  const paid = sales.filter((sale) => completedSale(sale) && isWithin(sale, from, to))
  const refunds = refundsWithin(sales, from, to)
  const cashRefunds = refunds.filter((refund) => refund.paymentMethod === 'cash').reduce((sum, refund) => sum + refund.amount, 0)
  const cardRefunds = refunds.filter((refund) => refund.paymentMethod === 'card').reduce((sum, refund) => sum + refund.amount, 0)
  const cashSales = paid.filter((sale) => sale.paymentMethod === 'cash').reduce((sum, sale) => sum + sale.total, 0) - cashRefunds
  const cardSales = paid.filter((sale) => sale.paymentMethod === 'card').reduce((sum, sale) => sum + sale.total, 0) - cardRefunds
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
      const closure = closureSnapshot(todaySales, { ...input, id: existingIndex >= 0 ? data.cashClosures[existingIndex].id : null }, todayFrom, todayTo)
      if (existingIndex >= 0) data.cashClosures[existingIndex] = closure
      else data.cashClosures.unshift(closure)
      return normalizeCashClosure(closure)
    })
  }

  const todaySales = await listSalesBetween(todayFrom, todayTo)
  const closure = closureSnapshot(todaySales, input, todayFrom, todayTo)
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
