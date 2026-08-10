import crypto from 'node:crypto'
import { WebhookSignatureValidator } from 'mercadopago'

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
  const { accessToken, terminalId, webhookSecret } = credentials()
  return {
    configured: mockMode || Boolean(accessToken && terminalId),
    mockMode,
    terminalConfigured: Boolean(terminalId),
    webhookConfigured: mockMode || Boolean(webhookSecret),
    terminalLabel: terminalId ? terminalId.split('__').at(-1)?.slice(-8) || '' : '',
    pilotReceiptEnabled: process.env.POINT_PILOT_RECEIPT_ENABLED === 'true',
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
          print_on_terminal: 'no_ticket',
        },
      },
    },
  })
}

export async function createPointPrintAction({ externalReference, content, subtype = 'image' }) {
  const { terminalId } = credentials()
  if (!terminalId) throw configurationError()
  if (!['custom', 'image'].includes(subtype)) {
    throw Object.assign(new Error('Unsupported Point print subtype.'), { status: 400 })
  }

  if (mockMode) {
    return {
      id: `MOCK-PRINT-${externalReference}`,
      type: 'print',
      external_reference: externalReference,
      status: 'processed',
    }
  }

  return mercadoPagoRequest('/terminals/v1/actions', {
    method: 'POST',
    idempotencyKey: `print-${externalReference}`,
    uncertainMessage: 'Mercado Pago did not confirm the pilot receipt print. Check the terminal before retrying.',
    body: {
      type: 'print',
      external_reference: externalReference,
      config: { point: { terminal_id: terminalId, subtype } },
      content,
    },
  })
}

export async function getPointPrintAction(actionId) {
  if (!actionId) throw Object.assign(new Error('Point print action ID is required.'), { status: 400 })
  if (mockMode) {
    return {
      id: String(actionId),
      type: 'print',
      status: 'processed',
    }
  }
  return mercadoPagoRequest(`/terminals/v1/actions/${encodeURIComponent(actionId)}`)
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
