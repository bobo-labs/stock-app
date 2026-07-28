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

export const api = {
  authStatus: () => request('/api/auth/status'),
  login: (pin) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ pin }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  items: () => request('/api/items'),
  movements: () => request('/api/movements?limit=100'),
  sales: () => request('/api/sales?limit=50'),
  posConfig: () => request('/api/pos/config'),
  terminal: () => request('/api/pos/terminal'),
  createItem: (item) => request('/api/items', { method: 'POST', body: JSON.stringify(item) }),
  updateItem: (id, item) => request(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify(item) }),
  adjustItem: (id, adjustment) => request(`/api/items/${id}/adjust`, { method: 'POST', body: JSON.stringify(adjustment) }),
  cashSale: (items) => request('/api/sales/cash', { method: 'POST', body: JSON.stringify({ items }) }),
  cardSale: (items) => request('/api/sales/card', { method: 'POST', body: JSON.stringify({ items }) }),
  sale: (id, refresh = false) => request(`/api/sales/${id}${refresh ? '?refresh=true' : ''}`),
  retryCardSale: (id) => request(`/api/sales/${id}/retry-card`, { method: 'POST' }),
  cancelSale: (id) => request(`/api/sales/${id}/cancel`, { method: 'POST' }),
}
