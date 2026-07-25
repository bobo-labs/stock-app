async function request(url, options) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Something went wrong.')
  return data
}

export const api = {
  items: () => request('/api/items'),
  movements: () => request('/api/movements?limit=100'),
  createItem: (item) => request('/api/items', { method: 'POST', body: JSON.stringify(item) }),
  updateItem: (id, item) => request(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify(item) }),
  adjustItem: (id, adjustment) => request(`/api/items/${id}/adjust`, { method: 'POST', body: JSON.stringify(adjustment) }),
}
