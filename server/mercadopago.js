import crypto from 'node:crypto'
import { WebhookSignatureValidator } from 'mercadopago'
import { renderPointRefundCopy } from './refund-receipt.js'

const apiBase = process.env.MERCADOPAGO_API_BASE || 'https://api.mercadopago.com'
const mockMode = process.env.MERCADOPAGO_MOCK === 'true'

function credentials() {
  return {
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || '',
    terminalId: process.env.MERCADOPAGO_POINT_TERMINAL_ID || '',
    webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET || '',
  }
}

export function pointIntegrationConfiguration() {
  const { accessToken, webhookSecret } = credentials()
  return {
    credentialsCentralized: mockMode || Boolean(accessToken),
    credentialStorage: mockMode ? 'mock' : 'server_environment',
    credentialsExposedToClient: false,
    accessTokenTransport: 'authorization_header',
    webhookConfigured: mockMode || Boolean(webhookSecret),
    webhookMode: 'application_order_topic',
    webhookTopic: 'order',
    webhookEndpointPath: '/api/mercadopago/webhook',
    webhookSignatureValidation: mockMode || Boolean(webhookSecret),
    webhookAuthoritativeOrderLookup: true,
  }
}

function configurationError() {
  return Object.assign(new Error('Mercado Pago is not configured. Add the access token and Point terminal ID in Railway.'), { status: 503 })
}

function accountConfigurationError() {
  return Object.assign(new Error('Mercado Pago account management is not configured. Add the server-side access token in Railway.'), { status: 503 })
}

async function mercadoPagoRequest(endpoint, { method = 'GET', body, idempotencyKey, uncertainMessage } = {}) {
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
    throw Object.assign(new Error(uncertainMessage || 'Mercado Pago could not be reached. The sale is still reserved; retry the connection before cancelling it.'), {
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

function accountIdFromMe(account) {
  const id = account?.id ?? account?.user_id
  if (!id) throw Object.assign(new Error('Mercado Pago did not return the seller account ID.'), { status: 502 })
  return String(id)
}

function queryString(values) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') query.set(key, String(value))
  }
  const encoded = query.toString()
  return encoded ? `?${encoded}` : ''
}

function collection(data, keys) {
  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key]
    if (Array.isArray(data?.data?.[key])) return data.data[key]
  }
  if (Array.isArray(data?.results)) return data.results
  if (Array.isArray(data?.data)) return data.data
  return []
}

function requireAccountAccess() {
  if (!mockMode && !credentials().accessToken) throw accountConfigurationError()
}

function cleanStorePayload(input = {}) {
  const location = input.location || {}
  const payload = {
    name: String(input.name || '').trim(),
    external_id: String(input.external_id || input.externalId || '').trim(),
    location: {},
  }
  for (const key of ['street_name', 'street_number', 'city_name', 'state_name', 'zip_code', 'reference']) {
    const value = location[key] ?? input[key]
    if (value !== undefined && value !== null && String(value).trim()) payload.location[key] = String(value).trim()
  }
  for (const key of ['latitude', 'longitude']) {
    const value = location[key] ?? input[key]
    if (value !== undefined && value !== null && String(value).trim()) payload.location[key] = Number(value)
  }
  if (!Object.keys(payload.location).length) delete payload.location
  return payload
}

function cleanPosPayload(input = {}) {
  const payload = {
    name: String(input.name || '').trim(),
    external_id: String(input.external_id || input.externalId || '').trim(),
  }
  for (const [key, value] of Object.entries({
    store_id: input.store_id ?? input.storeId,
    external_store_id: input.external_store_id ?? input.externalStoreId,
    category: input.category,
    url: input.url,
  })) {
    if (value !== undefined && value !== null && String(value).trim()) payload[key] = String(value).trim()
  }
  if (input.fixed_amount !== undefined || input.fixedAmount !== undefined) payload.fixed_amount = Boolean(input.fixed_amount ?? input.fixedAmount)
  return payload
}

function sameId(left, right) {
  return left !== undefined && left !== null && right !== undefined && right !== null && String(left) === String(right)
}

export function buildPointManagement({ account, stores = [], registers = [], terminals = [], paging = {} } = {}) {
  const { terminalId } = credentials()
  const storeById = new Map(stores.map((store) => [String(store.id), store]))
  const registerById = new Map(registers.map((register) => [String(register.id), register]))

  const managedTerminals = terminals.map((terminal) => {
    const store = terminal.store_id === undefined || terminal.store_id === null
      ? null
      : storeById.get(String(terminal.store_id)) || null
    const register = terminal.pos_id === undefined || terminal.pos_id === null
      ? null
      : registerById.get(String(terminal.pos_id)) || null
    const assignmentMatches = Boolean(store && register && sameId(register.store_id, store.id))
    const serial = String(terminal.id || '').split('__').at(-1) || String(terminal.id || '')
    const online = typeof terminal.connected === 'boolean' ? terminal.connected : null

    return {
      ...terminal,
      serial,
      online,
      configured: mockMode ? terminal.id === 'MOCK_POINT_SMART_2' : Boolean(terminalId && terminal.id === terminalId),
      ready: terminal.operating_mode === 'PDV' && assignmentMatches,
      assignment_status: assignmentMatches ? 'assigned' : (terminal.store_id || terminal.pos_id ? 'partial' : 'unassigned'),
      store: store ? { id: store.id, name: store.name, external_id: store.external_id } : null,
      register: register ? { id: register.id, name: register.name, external_id: register.external_id, store_id: register.store_id } : null,
      management_url: serial ? `https://www.mercadopago.cl/point/devices/${encodeURIComponent(serial)}` : '',
    }
  })

  const managedStores = stores.map((store) => ({
    ...store,
    register_count: registers.filter((register) => sameId(register.store_id, store.id)).length,
    terminal_count: managedTerminals.filter((terminal) => sameId(terminal.store_id, store.id)).length,
    assigned: managedTerminals.some((terminal) => sameId(terminal.store_id, store.id)),
  }))
  const managedRegisters = registers.map((register) => {
    const store = register.store_id === undefined || register.store_id === null
      ? null
      : storeById.get(String(register.store_id)) || null
    return {
      ...register,
      assigned: managedTerminals.some((terminal) => sameId(terminal.pos_id, register.id)),
      store: store ? { id: store.id, name: store.name, external_id: store.external_id } : null,
    }
  })

  return {
    account,
    stores: managedStores,
    registers: managedRegisters,
    terminals: managedTerminals,
    storePaging: paging.stores || {},
    registerPaging: paging.registers || {},
    terminalPaging: paging.terminals || {},
    configuration: {
      ...pointIntegrationConfiguration(),
      terminalConfigured: mockMode || Boolean(terminalId),
    },
    assignment: {
      apiSupported: false,
      method: 'mercado_pago_app',
    },
  }
}

export async function getMercadoPagoAccount() {
  requireAccountAccess()
  if (mockMode) return { id: 'MOCK-SELLER', nickname: 'MOCK_SELLER', site_id: 'MLC' }
  return mercadoPagoRequest('/users/me')
}

export async function listPointStores(filters = {}) {
  const account = await getMercadoPagoAccount()
  if (mockMode) return { stores: [], paging: { total: 0, limit: 50, offset: 0 }, account }
  const userId = accountIdFromMe(account)
  const response = await mercadoPagoRequest(`/users/${encodeURIComponent(userId)}/stores/search${queryString({ external_id: filters.externalId, limit: filters.limit || 50, offset: filters.offset || 0 })}`)
  return { stores: collection(response, ['stores']), paging: response?.paging || response?.data?.paging || {}, account }
}

export async function createPointStore(input) {
  const account = await getMercadoPagoAccount()
  if (mockMode) return { id: `MOCK-STORE-${Date.now()}`, ...cleanStorePayload(input) }
  const userId = accountIdFromMe(account)
  return mercadoPagoRequest(`/users/${encodeURIComponent(userId)}/stores`, {
    method: 'POST', idempotencyKey: crypto.randomUUID(), body: cleanStorePayload(input),
  })
}

export async function getPointStore(storeId) {
  await getMercadoPagoAccount()
  if (mockMode) return { id: storeId, name: 'Mock store' }
  return mercadoPagoRequest(`/stores/${encodeURIComponent(storeId)}`)
}

export async function updatePointStore(storeId, input) {
  const account = await getMercadoPagoAccount()
  if (mockMode) return { id: storeId, ...cleanStorePayload(input) }
  const userId = accountIdFromMe(account)
  return mercadoPagoRequest(`/users/${encodeURIComponent(userId)}/stores/${encodeURIComponent(storeId)}`, {
    method: 'PUT', idempotencyKey: crypto.randomUUID(), body: cleanStorePayload(input),
  })
}

export async function deletePointStore(storeId) {
  const account = await getMercadoPagoAccount()
  if (mockMode) return { id: storeId, deleted: true }
  const userId = accountIdFromMe(account)
  return mercadoPagoRequest(`/users/${encodeURIComponent(userId)}/stores/${encodeURIComponent(storeId)}`, {
    method: 'DELETE', idempotencyKey: crypto.randomUUID(),
  })
}

export async function listPointPos(filters = {}) {
  await getMercadoPagoAccount()
  if (mockMode) return { registers: [], paging: { total: 0, limit: 50, offset: 0 } }
  const response = await mercadoPagoRequest(`/pos${queryString({
    external_id: filters.externalId, external_store_id: filters.externalStoreId, store_id: filters.storeId,
    limit: filters.limit || 50, offset: filters.offset || 0,
  })}`)
  return { registers: collection(response, ['pos', 'points_of_sale']), paging: response?.paging || response?.data?.paging || {} }
}

export async function createPointPos(input) {
  await getMercadoPagoAccount()
  if (mockMode) return { id: `MOCK-POS-${Date.now()}`, ...cleanPosPayload(input) }
  return mercadoPagoRequest('/pos', { method: 'POST', idempotencyKey: crypto.randomUUID(), body: cleanPosPayload(input) })
}

export async function getPointPos(posId) {
  await getMercadoPagoAccount()
  if (mockMode) return { id: posId, name: 'Mock POS' }
  return mercadoPagoRequest(`/pos/${encodeURIComponent(posId)}`)
}

export async function updatePointPos(posId, input) {
  await getMercadoPagoAccount()
  if (mockMode) return { id: posId, ...cleanPosPayload(input) }
  return mercadoPagoRequest(`/pos/${encodeURIComponent(posId)}`, {
    method: 'PUT', idempotencyKey: crypto.randomUUID(), body: cleanPosPayload(input),
  })
}

export async function deletePointPos(posId) {
  await getMercadoPagoAccount()
  if (mockMode) return { id: posId, deleted: true }
  return mercadoPagoRequest(`/pos/${encodeURIComponent(posId)}`, { method: 'DELETE', idempotencyKey: crypto.randomUUID() })
}

export async function listPointTerminals(filters = {}) {
  await getMercadoPagoAccount()
  if (mockMode) return { terminals: [{ id: 'MOCK_POINT_SMART_2', operating_mode: 'PDV', connected: true }], paging: { total: 1 } }
  const response = await mercadoPagoRequest(`/terminals/v1/list${queryString({ limit: filters.limit || 50, offset: filters.offset || 0, store_id: filters.storeId, pos_id: filters.posId })}`)
  return { terminals: collection(response, ['terminals']), paging: response?.paging || response?.data?.paging || {} }
}

export async function setupPointTerminal(terminalId, operatingMode) {
  await getMercadoPagoAccount()
  if (!['PDV', 'STANDALONE'].includes(operatingMode)) throw Object.assign(new Error('The terminal mode is invalid.'), { status: 400 })
  if (mockMode) return { terminals: [{ id: terminalId, operating_mode: operatingMode }] }
  return mercadoPagoRequest('/terminals/v1/setup', {
    method: 'PATCH', idempotencyKey: crypto.randomUUID(), body: { terminals: [{ id: terminalId, operating_mode: operatingMode }] },
  })
}

function mockOrder(sale, status = 'created') {
  const processed = status === 'processed'
  return {
    id: `MOCK-${sale.id}`,
    type: 'point',
    external_reference: sale.mpExternalReference || `VENTA-${sale.shortId}`,
    status,
    status_detail: processed ? 'accredited' : status,
    transactions: {
      payments: [{
        id: `MOCK-PAY-${sale.id}`,
        reference_id: `MOCK-OP-${sale.shortId}`,
        amount: String(sale.total),
        paid_amount: processed ? String(sale.total) : undefined,
        status,
        status_detail: processed ? 'accredited' : status,
        payment_method: processed ? { id: 'visa', type: 'credit_card', installments: 1 } : undefined,
      }],
    },
  }
}

function mockRefundOrder(sale, refund) {
  const fullyRefunded = refund.full === true
  return {
    ...mockOrder(sale, 'processed'),
    status: fullyRefunded ? 'refunded' : 'processed',
    status_detail: fullyRefunded ? 'refunded' : 'partially_refunded',
    transactions: {
      payments: [{
        ...mockOrder(sale, 'processed').transactions.payments[0],
        status: fullyRefunded ? 'refunded' : 'processed',
        status_detail: fullyRefunded ? 'refunded' : 'partially_refunded',
      }],
      refunds: [{
        id: `MOCK-REFUND-${refund.id}`,
        amount: String(Math.round(refund.amount)),
        status: 'processed',
      }],
    },
  }
}

export function pointConfiguration() {
  const { accessToken, terminalId } = credentials()
  return {
    configured: mockMode || Boolean(accessToken && terminalId),
    mockMode,
    terminalConfigured: Boolean(terminalId),
    ...pointIntegrationConfiguration(),
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
      external_reference: sale.mpExternalReference || `VENTA-${sale.shortId}`,
      expiration_time: 'PT10M',
      description: `Bakery sale ${sale.shortId}`,
      transactions: { payments: [{ amount: String(Math.round(sale.total)) }] },
      config: {
        point: {
          terminal_id: terminalId,
          print_on_terminal: 'seller_ticket',
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

export async function getPointPayment(paymentId) {
  if (mockMode) return {
    id: paymentId,
    authorization_code: 'MOCK-AUTH',
    payment_method_id: 'visa',
    payment_type_id: 'credit_card',
    card: { last_four_digits: '4242' },
    fee_details: [{ type: 'mercadopago_fee', amount: 21 }],
    transaction_details: { net_received_amount: 979 },
    point_of_interaction: { transaction_data: { terminal_id: 'MOCK_POINT_SMART_2' } },
    additional_info: { tax_setting: 'CHARGE_TAXABLE_19' },
  }
  return mercadoPagoRequest(`/v1/payments/${encodeURIComponent(paymentId)}`)
}

export async function cancelPointOrder(orderId, sale) {
  if (mockMode) return mockOrder(sale, 'canceled')
  return mercadoPagoRequest(`/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    idempotencyKey: crypto.randomUUID(),
  })
}

export async function refundPointOrder(orderId, sale, refund) {
  if (mockMode) return mockRefundOrder(sale, refund)
  if (!sale.mpPaymentId) {
    throw Object.assign(new Error('Mercado Pago did not return a payment ID for this sale.'), { status: 409 })
  }

  return mercadoPagoRequest(`/v1/orders/${encodeURIComponent(orderId)}/refund`, {
    method: 'POST',
    idempotencyKey: refund.id,
    uncertainMessage: 'Mercado Pago did not confirm the refund. Retry it with the same request before taking another action.',
    body: refund.full ? undefined : {
      transactions: [{
        id: sale.mpPaymentId,
        amount: String(Math.round(refund.amount)),
      }],
    },
  })
}

export async function printPointRefundCopy(sale, refund) {
  const { terminalId } = credentials()
  if (!terminalId && !mockMode) throw configurationError()
  if (sale.paymentMethod !== 'card' || refund.status !== 'processed') {
    throw Object.assign(new Error('Only a processed Point refund can be printed.'), { status: 409 })
  }

  const requestId = crypto.randomUUID()
  const saleReference = String(sale.shortId || sale.id || 'SALE').replace(/[^a-z0-9_-]/gi, '').slice(0, 16).replace(/[-_]+$/g, '') || 'SALE'
  const refundReference = String(refund.id || 'REFUND').replace(/[^a-z0-9_-]/gi, '').slice(0, 12).replace(/[-_]+$/g, '') || 'REFUND'
  const externalReference = `REFUND-${saleReference}-${refundReference}-${requestId.slice(0, 8)}`.slice(0, 64)
  const content = renderPointRefundCopy(sale, refund)

  if (mockMode) {
    return {
      id: `MOCK-PRINT-${requestId}`,
      type: 'print',
      external_reference: externalReference,
      status: 'processed',
    }
  }

  return mercadoPagoRequest('/terminals/v1/actions', {
    method: 'POST',
    idempotencyKey: requestId,
    uncertainMessage: 'Mercado Pago did not confirm the refund-copy print. Check the terminal before trying again.',
    body: {
      type: 'print',
      external_reference: externalReference,
      config: { point: { terminal_id: terminalId, subtype: 'custom' } },
      content,
    },
  })
}

export async function getConfiguredTerminal() {
  const { terminalId } = credentials()
  if (mockMode) return { id: 'MOCK_POINT_SMART_2', operatingMode: 'PDV', connected: true, online: true, ready: true }
  if (!terminalId) throw configurationError()
  const response = await mercadoPagoRequest('/terminals/v1/list?limit=50&offset=0')
  const terminals = response?.data?.terminals || response?.terminals || []
  const terminal = terminals.find((entry) => entry.id === terminalId)
  if (!terminal) {
    return {
      id: terminalId,
      label: terminalId.split('__').at(-1)?.slice(-8) || '',
      operatingMode: 'NOT_FOUND',
      connected: false,
      online: null,
      ready: false,
    }
  }

  const ready = terminal.operating_mode === 'PDV' && Boolean(terminal.store_id) && Boolean(terminal.pos_id)
  const online = typeof terminal.connected === 'boolean' ? terminal.connected : null
  return {
    id: terminal.id,
    label: terminal.id.split('__').at(-1)?.slice(-8) || terminal.id,
    operatingMode: terminal.operating_mode,
    // Compatibility for older clients: this means configuration readiness, not network presence.
    connected: ready,
    online,
    ready,
    storeId: terminal.store_id,
    posId: terminal.pos_id,
  }
}

export function validatePointWebhook({ signature, requestId, dataId }) {
  const { webhookSecret } = credentials()
  if (mockMode) return true
  if (!webhookSecret || !signature || !dataId) return false

  try {
    WebhookSignatureValidator.validate({
      xSignature: signature,
      xRequestId: requestId,
      dataId,
      secret: webhookSecret.trim(),
    })
    return true
  } catch {
    return false
  }
}
