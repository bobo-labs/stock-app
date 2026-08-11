import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

function preserveEnvironment(names) {
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  return () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address()))
  })
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

test('Point adapter follows the documented Orders API contract', async () => {
  const restoreEnvironment = preserveEnvironment([
    'MERCADOPAGO_API_BASE',
    'MERCADOPAGO_MOCK',
    'MERCADOPAGO_ACCESS_TOKEN',
    'MERCADOPAGO_POINT_TERMINAL_ID',
    'MERCADOPAGO_WEBHOOK_SECRET',
  ])
  const terminalId = 'NEWLAND_N950__SBX0000001'
  const requests = []
  const server = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const bodyText = Buffer.concat(chunks).toString('utf8')
    const body = bodyText ? JSON.parse(bodyText) : null
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      idempotencyKey: request.headers['x-idempotency-key'],
      body,
    })

    response.setHeader('Content-Type', 'application/json')
    if (request.method === 'GET' && request.url === '/terminals/v1/list?limit=50&offset=0') {
      return response.end(JSON.stringify({
        data: { terminals: [{ id: terminalId, operating_mode: 'PDV', store_id: 'STORE-1', pos_id: 42 }] },
      }))
    }
    if (request.method === 'POST' && request.url === '/v1/orders') {
      response.statusCode = 201
      return response.end(JSON.stringify({
        id: 'ORD-MOCK-1', type: 'point', external_reference: body?.external_reference,
        status: 'created', status_detail: 'created', transactions: { payments: [{ id: 'PAY-MOCK-1', status: 'created' }] },
      }))
    }
    if (request.method === 'GET' && request.url === '/v1/orders/ORD-MOCK-1') {
      return response.end(JSON.stringify({
        id: 'ORD-MOCK-1', type: 'point', external_reference: 'sale-sale-uuid-1',
        status: 'processed', status_detail: 'accredited', transactions: { payments: [{ id: 'PAY-MOCK-1', status: 'processed', status_detail: 'accredited' }] },
      }))
    }
    if (request.method === 'GET' && request.url === '/v1/payments/172570565606') {
      return response.end(JSON.stringify({
        id: 172570565606, authorization_code: '253893', payment_method_id: 'master',
        payment_type_id: 'prepaid_card', card: { last_four_digits: '1249' },
        fee_details: [{ type: 'mercadopago_fee', amount: 21 }],
        transaction_details: { net_received_amount: 979 },
        additional_info: { tax_setting: 'CHARGE_TAXABLE_19' },
      }))
    }
    if (request.method === 'POST' && request.url === '/v1/orders/ORD-MOCK-1/cancel') {
      return response.end(JSON.stringify({
        id: 'ORD-MOCK-1', type: 'point', external_reference: 'sale-sale-uuid-1',
        status: 'canceled', status_detail: 'canceled', transactions: { payments: [{ id: 'PAY-MOCK-1', status: 'canceled' }] },
      }))
    }
    if (request.method === 'POST' && request.url === '/v1/orders/ORD-MOCK-1/refund') {
      response.statusCode = 201
      return response.end(JSON.stringify({
        id: 'ORD-MOCK-1', type: 'point', external_reference: 'sale-sale-uuid-1',
        status: 'processed', status_detail: 'partially_refunded',
        transactions: {
          payments: [{ id: 'PAY-MOCK-1', status: 'processed', status_detail: 'partially_refunded' }],
          refunds: [{ id: 'REFUND-MOCK-1', amount: body?.transactions?.[0]?.amount, status: 'processed' }],
        },
      }))
    }
    if (request.method === 'POST' && request.url === '/terminals/v1/actions') {
      response.statusCode = 201
      return response.end(JSON.stringify({
        id: 'PRINT-ACTION-1', type: 'print', external_reference: body?.external_reference, status: 'created',
      }))
    }
    if (request.method === 'GET' && request.url === '/terminals/v1/actions/PRINT-ACTION-1') {
      return response.end(JSON.stringify({
        id: 'PRINT-ACTION-1', type: 'print', external_reference: 'PILOT-SALE0001', status: 'processed',
      }))
    }
    response.statusCode = 404
    response.end(JSON.stringify({ error: 'unexpected_request' }))
  })

  try {
    const address = await listen(server)
    process.env.MERCADOPAGO_API_BASE = `http://127.0.0.1:${address.port}`
    process.env.MERCADOPAGO_MOCK = 'false'
    process.env.MERCADOPAGO_ACCESS_TOKEN = 'test-access-token'
    process.env.MERCADOPAGO_POINT_TERMINAL_ID = terminalId
    process.env.MERCADOPAGO_WEBHOOK_SECRET = 'test-webhook-secret'
    const point = await import(`./mercadopago.js?contract=${Date.now()}`)
    const sale = { id: 'sale-uuid-1', shortId: 'SALE0001', mpExternalReference: 'VENTA-SALE0001', total: 4850, createdAt: new Date().toISOString() }

    assert.deepEqual(point.pointConfiguration(), {
      configured: true,
      mockMode: false,
      terminalConfigured: true,
      webhookConfigured: true,
      terminalLabel: 'X0000001',
    })

    assert.deepEqual(await point.getConfiguredTerminal(), {
      id: terminalId,
      label: 'X0000001',
      operatingMode: 'PDV',
      connected: true,
      storeId: 'STORE-1',
      posId: 42,
    })

    const created = await point.createPointOrder(sale)
    assert.equal(created.status, 'created')
    assert.equal((await point.getPointOrder(created.id, sale)).status, 'processed')
    assert.equal((await point.getPointPayment('172570565606')).authorization_code, '253893')
    assert.equal((await point.cancelPointOrder(created.id, sale)).status, 'canceled')
    const refunded = await point.refundPointOrder(created.id, { ...sale, mpPaymentId: 'PAY-MOCK-1' }, {
      id: 'refund-uuid-1', amount: 1850, full: false,
    })
    assert.equal(refunded.status_detail, 'partially_refunded')
    assert.deepEqual(requests.map(({ method, url }) => ({ method, url })), [
      { method: 'GET', url: '/terminals/v1/list?limit=50&offset=0' },
      { method: 'POST', url: '/v1/orders' },
      { method: 'GET', url: '/v1/orders/ORD-MOCK-1' },
      { method: 'GET', url: '/v1/payments/172570565606' },
      { method: 'POST', url: '/v1/orders/ORD-MOCK-1/cancel' },
      { method: 'POST', url: '/v1/orders/ORD-MOCK-1/refund' },
    ])
    assert.ok(requests.every((request) => request.authorization === 'Bearer test-access-token'))
    assert.equal(requests[1].idempotencyKey, sale.id)
    assert.match(requests[4].idempotencyKey, /^[0-9a-f]{8}-[0-9a-f-]{27}$/i)
    assert.equal(requests[5].idempotencyKey, 'refund-uuid-1')
    assert.deepEqual(requests[5].body, { transactions: [{ id: 'PAY-MOCK-1', amount: '1850' }] })
    assert.deepEqual(requests[1].body, {
      type: 'point',
      external_reference: sale.mpExternalReference,
      expiration_time: 'PT10M',
      description: `Bakery sale ${sale.shortId}`,
      transactions: { payments: [{ amount: '4850' }] },
      config: { point: { terminal_id: terminalId, print_on_terminal: 'no_ticket' } },
    })
  } finally {
    if (server.listening) await close(server)
    restoreEnvironment()
  }
})

test('built-in Point mock simulates terminal arrival, approval, and cancellation', async () => {
  const restoreEnvironment = preserveEnvironment([
    'MERCADOPAGO_MOCK',
    'MERCADOPAGO_ACCESS_TOKEN',
    'MERCADOPAGO_POINT_TERMINAL_ID',
    'MERCADOPAGO_WEBHOOK_SECRET',
  ])
  try {
    process.env.MERCADOPAGO_MOCK = 'true'
    delete process.env.MERCADOPAGO_ACCESS_TOKEN
    delete process.env.MERCADOPAGO_POINT_TERMINAL_ID
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET
    const point = await import(`./mercadopago.js?mock=${Date.now()}`)
    const sale = { id: 'mock-sale-1', shortId: 'MOCK0001', total: 3200, createdAt: new Date().toISOString() }

    assert.equal(point.pointConfiguration().configured, true)
    assert.deepEqual(await point.getConfiguredTerminal(), {
      id: 'MOCK_POINT_SMART_2', operatingMode: 'PDV', connected: true,
    })
    assert.equal((await point.createPointOrder(sale)).status, 'created')
    assert.equal((await point.getPointOrder('MOCK-mock-sale-1', sale)).status, 'at_terminal')

    const olderSale = { ...sale, createdAt: new Date(Date.now() - 1500).toISOString() }
    const processed = await point.getPointOrder('MOCK-mock-sale-1', olderSale)
    assert.equal(processed.status, 'processed')
    assert.equal(processed.status_detail, 'accredited')
    assert.equal(processed.transactions.payments[0].paid_amount, '3200')
    assert.equal((await point.cancelPointOrder('MOCK-mock-sale-1', sale)).status, 'canceled')
    const partialRefund = await point.refundPointOrder('MOCK-mock-sale-1', { ...sale, mpPaymentId: 'MOCK-PAY-mock-sale-1' }, {
      id: 'mock-refund-1', amount: 1200, full: false,
    })
    assert.equal(partialRefund.status_detail, 'partially_refunded')
    const fullRefund = await point.refundPointOrder('MOCK-mock-sale-1', { ...sale, mpPaymentId: 'MOCK-PAY-mock-sale-1' }, {
      id: 'mock-refund-2', amount: 3200, full: true,
    })
    assert.equal(fullRefund.status, 'refunded')
  } finally {
    restoreEnvironment()
  }
})
