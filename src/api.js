async function request(url, options) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || 'Something went wrong.')
    Object.assign(error, { status: response.status, ...data })
    throw error
  }
  return data
}

function localDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function metricsPeriod(range = 'today') {
  const now = new Date()
  const todayFrom = new Date(now)
  todayFrom.setHours(0, 0, 0, 0)
  const from = new Date(todayFrom)
  if (range === '7d') from.setDate(from.getDate() - 6)
  if (range === '30d') from.setDate(from.getDate() - 29)
  const duration = now.getTime() - from.getTime()
  const previousTo = new Date(from)
  const previousFrom = new Date(previousTo.getTime() - duration)
  return {
    from: from.toISOString(),
    to: new Date(now.getTime() + 1000).toISOString(),
    previousFrom: previousFrom.toISOString(),
    previousTo: previousTo.toISOString(),
    todayFrom: todayFrom.toISOString(),
    todayTo: new Date(now.getTime() + 1000).toISOString(),
    businessDate: localDateKey(now),
  }
}

export const api = {
  authStatus: () => request('/api/auth/status'),
  login: (pin) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ pin }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  items: () => request('/api/items'),
  movements: () => request('/api/movements?limit=100'),
  sales: () => request('/api/sales?limit=50'),
  metrics: (range = 'today') => request(`/api/metrics?${new URLSearchParams(metricsPeriod(range))}`),
  saveCashClosure: (closure) => request('/api/cash-closures', { method: 'POST', body: JSON.stringify({ ...metricsPeriod('today'), ...closure }) }),
  dailyReportUrl: (language = 'es') => `/api/reports/daily?${new URLSearchParams({ ...metricsPeriod('today'), language })}`,
  posConfig: () => request('/api/pos/config'),
  terminal: () => request('/api/pos/terminal'),
  posManagement: () => request('/api/pos/management'),
  createPointStore: (store) => request('/api/pos/stores', { method: 'POST', body: JSON.stringify(store) }),
  updatePointStore: (id, store) => request(`/api/pos/stores/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(store) }),
  deletePointStore: (id) => request(`/api/pos/stores/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createPointRegister: (register) => request('/api/pos/registers', { method: 'POST', body: JSON.stringify(register) }),
  updatePointRegister: (id, register) => request(`/api/pos/registers/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(register) }),
  deletePointRegister: (id) => request(`/api/pos/registers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  setPointTerminalMode: (id, operating_mode) => request(`/api/pos/terminals/${encodeURIComponent(id)}/mode`, { method: 'PATCH', body: JSON.stringify({ operating_mode }) }),
  createItem: (item) => request('/api/items', { method: 'POST', body: JSON.stringify(item) }),
  updateItem: (id, item) => request(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify(item) }),
  deleteItem: (id) => request(`/api/items/${id}`, { method: 'DELETE' }),
  adjustItem: (id, adjustment) => request(`/api/items/${id}/adjust`, { method: 'POST', body: JSON.stringify(adjustment) }),
  cashSale: (items) => request('/api/sales/cash', { method: 'POST', body: JSON.stringify({ items }) }),
  cardSale: (items) => request('/api/sales/card', { method: 'POST', body: JSON.stringify({ items }) }),
  sale: (id, refresh = false) => request(`/api/sales/${id}${refresh ? '?refresh=true' : ''}`),
  retryCardSale: (id) => request(`/api/sales/${id}/retry-card`, { method: 'POST' }),
  cancelSale: (id) => request(`/api/sales/${id}/cancel`, { method: 'POST' }),
  refundSale: (id, refund) => request(`/api/sales/${id}/refunds`, { method: 'POST', body: JSON.stringify(refund) }),
  retryRefund: (saleId, refundId) => request(`/api/sales/${saleId}/refunds/${refundId}/retry`, { method: 'POST' }),
  printRefundCopy: (saleId, refundId) => request(`/api/sales/${saleId}/refunds/${refundId}/print-copy`, { method: 'POST' }),
  reconcilePointSale: (saleId) => request(`/api/sales/${saleId}/reconcile-point`, { method: 'POST' }),
  resolveRefundInventory: (saleId, refundId, restock) => request(`/api/sales/${saleId}/refunds/${refundId}/inventory-review`, { method: 'PATCH', body: JSON.stringify({ restock }) }),
  recordCreditNote: (saleId, refundId, creditNote) => request(`/api/sales/${saleId}/refunds/${refundId}/credit-note`, { method: 'PATCH', body: JSON.stringify(creditNote) }),
}
