import crypto from 'node:crypto'

const apiBase = process.env.MERCADOPAGO_API_BASE || 'https://api.mercadopago.com'
const mockMode = process.env.MERCADOPAGO_MOCK === 'true'

function credentials() {
  return {
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || '',
    terminalId: process.env.MERCADOPAGO_POINT_TERMINAL_ID || '',
    webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET || '',
  }
}

function configurationError() {
  return Object.assign(new Error('Mercado Pago is not configured. Add the access token and Point terminal ID in Railway.'), { status: 503 })
}

async function mercadoPagoRequest(endpoint, { method = 'GET', body, idempotencyKey } = {}) {
  const { accessToken } = credentials()
  if (!accessToken) throw configurationError()

  let response
  try {
    response = await fetch(`${apiBase}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    })
  } catch (error) {
    throw Object.assign(new Error('Mercado Pago could not be reached. The sale is still reserved; retry the connection before cancelling it.'), {
      status: 502,
      uncertain: true,
      cause: error,
    })
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = data?.errors?.[0]?.message || data?.message || data?.error || `Request failed with status ${response.status}`
    throw Object.assign(new Error(`Mercado Pago: ${detail}`), {
      status: response.status === 401 || response.status === 403 ? 502 : Math.max(400, Math.min(response.status, 503)),
      mercadoPagoStatus: response.status,
      mercadoPagoCode: data?.code || data?.errors?.[0]?.code || '',
    })
  }
  return data
}

function mockOrder(sale, status = 'created') {
  const processed = status === 'processed'
  return {
    id: `MOCK-${sale.id}`,
    type: 'point',
    external_reference: `sale-${sale.id}`,
    status,
    status_detail: processed ? 'accredited' : status,
    transactions: {
      payments: [{
        id: `MOCK-PAY-${sale.id}`,
        amount: String(sale.total),
        paid_amount: processed ? String(sale.total) : undefined,
        status,
        status_detail: processed ? 'accredited' : status,
        payment_method: processed ? { id: 'visa', type: 'credit_card', installments: 1 } : undefined,
      }],
    },
  }
}

export function pointConfiguration() {
  const { accessToken, terminalId, webhookSecret } = credentials()
  return {
    configured: mockMode || Boolean(accessToken && terminalId),
    mockMode,
    terminalConfigured: Boolean(terminalId),
    webhookConfigured: mockMode || Boolean(webhookSecret),
    terminalLabel: terminalId ? terminalId.split('__').at(-1)?.slice(-8) || '' : '',
  }
}

export async function createPointOrder(sale) {
  const { terminalId } = credentials()
  if (mockMode) return mockOrder(sale)
  if (!terminalId) throw configurationError()

  return mercadoPagoRequest('/v1/orders', {
    method: 'POST',
    idempotencyKey: sale.id,
    body: {
      type: 'point',
      external_reference: `sale-${sale.id}`,
      expiration_time: 'PT10M',
      description: `Bakery sale ${sale.shortId}`,
      transactions: { payments: [{ amount: String(Math.round(sale.total)) }] },
      config: {
        point: {
          terminal_id: terminalId,
          print_on_terminal: 'no_ticket',
        },
      },
    },
  })
}

export async function getPointOrder(orderId, sale) {
  if (mockMode) {
    const age = Date.now() - new Date(sale.createdAt).getTime()
    return mockOrder(sale, age > 1200 ? 'processed' : 'at_terminal')
  }
  return mercadoPagoRequest(`/v1/orders/${encodeURIComponent(orderId)}`)
}

export async function cancelPointOrder(orderId, sale) {
  if (mockMode) return mockOrder(sale, 'canceled')
  return mercadoPagoRequest(`/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    idempotencyKey: crypto.randomUUID(),
  })
}

export async function getConfiguredTerminal() {
  const { terminalId } = credentials()
  if (mockMode) return { id: 'MOCK_POINT_SMART_2', operatingMode: 'PDV', connected: true }
  if (!terminalId) throw configurationError()
  const response = await mercadoPagoRequest('/terminals/v1/list?limit=50&offset=0')
  const terminals = response?.data?.terminals || response?.terminals || []
  const terminal = terminals.find((entry) => entry.id === terminalId)
  return terminal ? {
    id: terminal.id,
    label: terminal.id.split('__').at(-1)?.slice(-8) || terminal.id,
    operatingMode: terminal.operating_mode,
    connected: terminal.operating_mode === 'PDV',
    storeId: terminal.store_id,
    posId: terminal.pos_id,
  } : { id: terminalId, label: terminalId.split('__').at(-1)?.slice(-8) || '', operatingMode: 'NOT_FOUND', connected: false }
}

export function validatePointWebhook({ signature, requestId, dataId }) {
  const { webhookSecret } = credentials()
  if (mockMode) return true
  if (!webhookSecret || !signature || !requestId || !dataId) return false

  const parts = Object.fromEntries(signature.split(',').map((part) => part.trim().split('=')))
  if (!parts.ts || !parts.v1) return false
  const manifest = `id:${dataId};request-id:${requestId};ts:${parts.ts};`
  const expected = crypto.createHmac('sha256', webhookSecret).update(manifest).digest('hex')
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(parts.v1)
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
}
