import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowRight, ArrowUp, BadgeCheck, Banknote, BarChart3,
  Boxes, CalendarClock, Check, ChevronRight, CirclePlus, Clock3, CreditCard,
  Croissant, History, LayoutDashboard, LockKeyhole, LogOut, Menu, Minus,
  PackageOpen, Pencil, Plus, ReceiptText, RotateCw, Search, ShoppingBasket,
  SlidersHorizontal, Sparkles, Trash2, Wifi, X,
} from 'lucide-react'
import { api } from './api.js'
import { useI18n } from './i18n.js'

const categories = ['Bread', 'Pastries', 'Cakes', 'Ingredients', 'Packaging', 'Drinks', 'Other']
const units = ['pieces', 'loaves', 'cakes', 'kg', 'g', 'litres', 'bottles', 'boxes', 'packs']

function formatQuantity(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function daysUntil(dateValue) {
  if (!dateValue) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(`${dateValue}T00:00:00`)
  return Math.ceil((target - today) / 86400000)
}

function stockState(item, t) {
  if (item.quantity === 0) return { label: t('outOfStock'), tone: 'danger' }
  if (item.quantity <= item.lowStockThreshold) return { label: t('lowStockStatus'), tone: 'warning' }
  return { label: t('inStock'), tone: 'success' }
}

function saleState(status, t) {
  const states = {
    paid: { label: t('salePaid'), tone: 'success' },
    pending: { label: t('salePending'), tone: 'warning' },
    failed: { label: t('saleFailed'), tone: 'danger' },
    cancelled: { label: t('saleCancelled'), tone: 'neutral' },
    expired: { label: t('saleExpired'), tone: 'neutral' },
    refunded: { label: t('saleRefunded'), tone: 'neutral' },
  }
  return states[status] || states.pending
}

function LanguageToggle() {
  const { language, setLanguage, t } = useI18n()
  return <div className="language-toggle" role="group" aria-label={t('language')}>
    <button className={language === 'es' ? 'active' : ''} onClick={() => setLanguage('es')} aria-pressed={language === 'es'}>ES</button>
    <button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')} aria-pressed={language === 'en'}>EN</button>
  </div>
}

function LoginScreen({ onLogin }) {
  const { t } = useI18n()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('')
    try { await onLogin(pin); setPin('') } catch (nextError) { setError(nextError.message) } finally { setBusy(false) }
  }
  return <main className="login-page">
    <div className="login-language"><LanguageToggle /></div>
    <section className="login-card">
      <div className="login-mark"><Croissant size={31} /></div>
      <span className="eyebrow">Bakery POS</span>
      <h1>{t('welcomeBack')}</h1>
      <p>{t('loginDescription')}</p>
      <form onSubmit={submit}>
        <label htmlFor="staff-pin">{t('staffPin')}</label>
        <div className="pin-input"><LockKeyhole size={19} /><input id="staff-pin" type="password" inputMode="numeric" autoComplete="current-password" autoFocus required value={pin} onChange={(event) => setPin(event.target.value)} placeholder="••••" /></div>
        {error && <div className="inline-error"><AlertTriangle size={16} />{error}</div>}
        <button className="button primary" disabled={busy}>{busy ? t('signingIn') : t('signIn')}<ArrowRight size={18} /></button>
      </form>
    </section>
  </main>
}

function Modal({ title, eyebrow, onClose, children, wide = false, closeable = true }) {
  const { t } = useI18n()
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && closeable && onClose()
    document.addEventListener('keydown', onKey)
    document.body.classList.add('modal-open')
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open') }
  }, [closeable, onClose])

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => closeable && event.target === event.currentTarget && onClose()}>
    <section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-handle" />
      <header className="modal-header">
        <div><span className="eyebrow">{eyebrow}</span><h2 id="modal-title">{title}</h2></div>
        {closeable && <button className="icon-button" onClick={onClose} aria-label={t('close')}><X size={20} /></button>}
      </header>
      {children}
    </section>
  </div>
}

function ProductForm({ item, onSubmit, onDelete, onClose, busy }) {
  const { t, categoryLabel, unitLabel } = useI18n()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [form, setForm] = useState({
    name: item?.name || '', category: item?.category || 'Bread', unit: item?.unit || 'pieces',
    quantity: item?.quantity ?? '', lowStockThreshold: item?.lowStockThreshold ?? '',
    sku: item?.sku || '', expiryDate: item?.expiryDate?.slice(0, 10) || '',
    price: item?.price || '', sellable: item?.sellable ?? true,
  })
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  if (confirmingDelete) return <div className="delete-confirmation">
    <div className="delete-confirmation-icon"><Trash2 size={26} /></div>
    <h3>{t('deleteProductQuestion')}</h3>
    <p>{t('deleteProductDescription', { name: item.name })}</p>
    {item.quantity > 0 && <div className="delete-stock-warning"><AlertTriangle size={18} /><span>{t('deleteProductStockWarning', { count: formatQuantity(item.quantity), unit: unitLabel(item.unit) })}</span></div>}
    <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setConfirmingDelete(false)} disabled={busy}>{t('keepProduct')}</button><button type="button" className="button danger-button" onClick={onDelete} disabled={busy}>{busy ? t('deleting') : t('deletePermanently')}<Trash2 size={18} /></button></div>
  </div>
  return <form onSubmit={(event) => { event.preventDefault(); onSubmit(form) }} className="form-stack">
    <div className="field full"><label htmlFor="name">{t('productName')}</label><input id="name" autoFocus required value={form.name} onChange={update('name')} placeholder={t('productNamePlaceholder')} /></div>
    <div className="sellable-panel">
      <label className="switch-field"><input type="checkbox" checked={form.sellable} onChange={(event) => setForm((current) => ({ ...current, sellable: event.target.checked }))} /><i /><span><strong>{t('sellAtCounter')}</strong><small>{t('sellAtCounterDescription')}</small></span></label>
      <div className="field price-field"><label htmlFor="price">{t('salePrice')}</label><div className="money-input"><span>$</span><input id="price" type="number" min={form.sellable ? '1' : '0'} step="1" required={form.sellable} disabled={!form.sellable} value={form.price} onChange={update('price')} placeholder="0" /></div></div>
    </div>
    <div className="form-grid">
      <div className="field"><label htmlFor="category">{t('category')}</label><select id="category" value={form.category} onChange={update('category')}>{categories.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}</select></div>
      <div className="field"><label htmlFor="unit">{t('measuredIn')}</label><select id="unit" value={form.unit} onChange={update('unit')}>{units.map((unit) => <option key={unit} value={unit}>{unitLabel(unit)}</option>)}</select></div>
      {!item && <div className="field"><label htmlFor="quantity">{t('openingQuantity')}</label><input id="quantity" type="number" min="0" step="0.01" required value={form.quantity} onChange={update('quantity')} placeholder="0" /></div>}
      <div className="field"><label htmlFor="threshold">{t('lowStockAlert')}</label><input id="threshold" type="number" min="0" step="0.01" required value={form.lowStockThreshold} onChange={update('lowStockThreshold')} placeholder="0" /></div>
      <div className="field"><label htmlFor="expiry">{t('expiryDate')} <span>{t('optional')}</span></label><input id="expiry" type="date" value={form.expiryDate} onChange={update('expiryDate')} /></div>
      <div className="field"><label htmlFor="sku">{t('sku')} <span>{t('optional')}</span></label><input id="sku" value={form.sku} onChange={update('sku')} placeholder={t('skuPlaceholder')} /></div>
    </div>
    {item && <button type="button" className="delete-product-link" onClick={() => setConfirmingDelete(true)}><Trash2 size={16} />{t('deleteProduct')}</button>}
    <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>{t('cancel')}</button><button className="button primary" disabled={busy}>{busy ? t('saving') : item ? t('saveChanges') : t('addProduct')}<Check size={18} /></button></div>
  </form>
}

function AdjustForm({ item, initialType = 'stock_in', onSubmit, onClose, busy }) {
  const { t, unitLabel } = useI18n()
  const [type, setType] = useState(initialType)
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const newBalance = type === 'adjustment' ? Number(quantity || item.quantity) : Math.max(0, item.quantity + (type === 'stock_in' ? 1 : -1) * Number(quantity || 0))
  return <form onSubmit={(event) => { event.preventDefault(); onSubmit({ type, quantity, note }) }} className="form-stack">
    <div className="current-balance"><div className="product-glyph"><Croissant size={22} /></div><div><span>{t('currentBalance')}</span><strong>{formatQuantity(item.quantity)} {unitLabel(item.unit)}</strong></div></div>
    <div className="segmented" aria-label={t('stockAction')}>
      <button type="button" className={type === 'stock_in' ? 'active' : ''} onClick={() => setType('stock_in')}><Plus size={17} /> {t('stockIn')}</button>
      <button type="button" className={type === 'stock_out' ? 'active' : ''} onClick={() => setType('stock_out')}><Minus size={17} /> {t('stockOut')}</button>
      <button type="button" className={type === 'adjustment' ? 'active' : ''} onClick={() => setType('adjustment')}><SlidersHorizontal size={17} /> {t('setCount')}</button>
    </div>
    <div className="field full"><label htmlFor="adjust-quantity">{type === 'adjustment' ? t('newTotalQuantity') : t('quantity')}</label><div className="input-suffix"><input id="adjust-quantity" autoFocus type="number" min="0" max={type === 'stock_out' ? item.quantity : undefined} step="0.01" required value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="0" /><span>{unitLabel(item.unit)}</span></div></div>
    <div className="balance-preview"><span>{t('balanceAfterUpdate')}</span><strong>{formatQuantity(newBalance)} {unitLabel(item.unit)}</strong></div>
    <div className="field full"><label htmlFor="note">{t('note')} <span>{t('optional')}</span></label><input id="note" value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('notePlaceholder')} /></div>
    <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>{t('cancel')}</button><button className="button primary" disabled={busy}>{busy ? t('updating') : t('updateStockButton')}<ArrowRight size={18} /></button></div>
  </form>
}

function EmptyState({ onAdd }) {
  const { t } = useI18n()
  return <div className="empty-state"><div className="empty-art"><PackageOpen size={32} /></div><h3>{t('shelvesReady')}</h3><p>{t('emptyInventoryDescription')}</p><button className="button primary" onClick={onAdd}><Plus size={18} /> {t('addFirstProduct')}</button></div>
}

function InventoryList({ items, onAdjust, onEdit }) {
  const { t, categoryLabel, unitLabel, formatDate, formatCurrency } = useI18n()
  return <div className="inventory-list">
    <div className="inventory-head"><span>{t('product')}</span><span>{t('available')}</span><span>{t('status')}</span><span>{t('expiry')}</span><span aria-hidden="true" /></div>
    {items.map((item) => {
      const state = stockState(item, t); const expiry = daysUntil(item.expiryDate)
      const details = [categoryLabel(item.category), item.sku, item.sellable && item.price > 0 ? formatCurrency(item.price) : t('notForSale')].filter(Boolean).join(' · ')
      return <article className="inventory-row" key={item.id}>
        <div className="product-cell"><div className={`product-glyph category-${item.category.toLowerCase()}`}><Croissant size={20} /></div><div><strong>{item.name}</strong><span>{details}</span></div></div>
        <div className="quantity-cell"><strong>{formatQuantity(item.quantity)}</strong><span>{unitLabel(item.unit)}</span></div>
        <div><span className={`status ${state.tone}`}><i />{state.label}</span></div>
        <div className={`expiry-cell ${expiry !== null && expiry <= 2 ? 'urgent' : ''}`}>{item.expiryDate ? <><CalendarClock size={16} /><span>{expiry < 0 ? t('expired') : expiry === 0 ? t('todayExpiry') : formatDate(item.expiryDate)}</span></> : <span>—</span>}</div>
        <div className="row-actions"><button className="button compact" onClick={() => onAdjust(item)}>{t('updateStockButton')}</button><button className="icon-button subtle" onClick={() => onEdit(item)} aria-label={`${t('productDetails')}: ${item.name}`}><Pencil size={17} /></button></div>
      </article>
    })}
  </div>
}

function Dashboard({ items, movements, sales, onAdd, onAdjust, onGoInventory, onGoPos }) {
  const { t, categoryLabel, unitLabel, formatCurrency } = useI18n()
  const lowItems = items.filter((item) => item.quantity <= item.lowStockThreshold)
  const expiring = items.filter((item) => { const days = daysUntil(item.expiryDate); return days !== null && days >= 0 && days <= 3 })
  const unitsOnHand = items.reduce((sum, item) => sum + Number(item.quantity), 0)
  const today = new Date().toDateString()
  const todaySales = sales.filter((sale) => sale.status === 'paid' && new Date(sale.paidAt || sale.createdAt).toDateString() === today)
  const todayRevenue = todaySales.reduce((sum, sale) => sum + sale.total, 0)
  const categoriesData = Object.entries(items.reduce((acc, item) => ({ ...acc, [item.category]: (acc[item.category] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])
  const maxCategory = Math.max(...categoriesData.map(([, value]) => value), 1)
  const greetingKey = new Date().getHours() < 12 ? 'greetingMorning' : new Date().getHours() < 18 ? 'greetingAfternoon' : 'greetingEvening'
  return <div className="page enter">
    <section className="welcome-row"><div><span className="eyebrow">{t('liveInventory')}</span><h1>{t(greetingKey)}</h1><p>{t('welcomeMessage')}</p></div><div className="heading-actions"><button className="button secondary desktop-action" onClick={onGoPos}><ShoppingBasket size={19} /> {t('newSale')}</button><button className="button primary desktop-action" onClick={onAdd}><CirclePlus size={19} /> {t('addProduct')}</button></div></section>
    <section className="metrics" aria-label={t('inventorySummary')}>
      <div className="metric-card"><div className="metric-icon cocoa"><ReceiptText size={20} /></div><div><span>{t('salesToday')}</span><strong>{formatCurrency(todayRevenue)}</strong><small>{t('transactionsToday', { count: todaySales.length })}</small></div></div>
      <div className="metric-card"><div className="metric-icon sage"><BarChart3 size={20} /></div><div><span>{t('unitsOnHand')}</span><strong>{formatQuantity(unitsOnHand)}</strong><small>{t('currentRecordedTotal')}</small></div></div>
      <div className={`metric-card ${lowItems.length ? 'attention' : ''}`}><div className="metric-icon amber"><AlertTriangle size={20} /></div><div><span>{t('needAttention')}</span><strong>{lowItems.length}</strong><small>{lowItems.length ? t('atOrBelowMinimum') : t('everythingHealthy')}</small></div></div>
      <div className="metric-card"><div className="metric-icon rose"><CalendarClock size={20} /></div><div><span>{t('expiringSoon')}</span><strong>{expiring.length}</strong><small>{t('next3Days')}</small></div></div>
    </section>
    <section className="dashboard-grid">
      <div className="card stock-card"><header className="card-header"><div><span className="eyebrow">{t('inventoryHealth')}</span><h2>{t('stockRequiringAttention')}</h2></div><button className="text-button" onClick={onGoInventory}>{t('viewAll')} <ChevronRight size={17} /></button></header>
        {lowItems.length ? <div className="attention-list">{lowItems.slice(0, 5).map((item) => <button key={item.id} onClick={() => onAdjust(item)}><div className="product-glyph"><Croissant size={19} /></div><div className="attention-copy"><strong>{item.name}</strong><span>{categoryLabel(item.category)} · {t('minimum')} {formatQuantity(item.lowStockThreshold)}</span></div><div className="attention-count"><strong>{formatQuantity(item.quantity)}</strong><span>{unitLabel(item.unit)}</span></div><ChevronRight size={18} /></button>)}</div> : <div className="all-good"><div><Sparkles size={24} /></div><h3>{t('everythingStocked')}</h3><p>{t('noBelowAlert')}</p></div>}
      </div>
      <div className="card category-card"><header className="card-header"><div><span className="eyebrow">{t('productMix')}</span><h2>{t('byCategory')}</h2></div></header>
        {categoriesData.length ? <div className="category-bars">{categoriesData.slice(0, 6).map(([category, count], index) => <div className="category-bar" key={category}><div><span>{categoryLabel(category)}</span><strong>{count}</strong></div><div className="bar-track"><i style={{ width: `${(count / maxCategory) * 100}%`, '--delay': `${index * 60}ms` }} /></div></div>)}</div> : <p className="muted">{t('categoriesEmpty')}</p>}
      </div>
      <div className="card activity-card"><header className="card-header"><div><span className="eyebrow">{t('latestChanges')}</span><h2>{t('recentActivity')}</h2></div></header>
        {movements.length ? <div className="activity-list">{movements.slice(0, 6).map((movement) => <Movement key={movement.id} movement={movement} />)}</div> : <div className="all-good small"><Clock3 size={23} /><p>{t('stockActivityEmpty')}</p></div>}
      </div>
    </section>
  </div>
}

function Movement({ movement }) {
  const { t, formatTime } = useI18n()
  const positive = movement.quantity >= 0
  const cashSale = movement.note.match(/^Sale #(\w+)/)
  const reservedSale = movement.note.match(/^Reserved for card sale #(\w+)/)
  const restoredSale = movement.note.match(/^Card sale #(\w+).+stock restored$/)
  const note = movement.note === 'Opening stock' ? t('openingStock')
    : cashSale ? t('saleMovement', { id: cashSale[1] })
      : reservedSale ? t('cardStockReserved', { id: reservedSale[1] })
        : restoredSale ? t('cardStockRestored', { id: restoredSale[1] })
          : movement.note || (movement.type === 'stock_in' ? t('stockReceived') : movement.type === 'stock_out' ? t('stockRemoved') : t('countCorrected'))
  return <div className="activity-item"><div className={`movement-icon ${movement.type}`}>{movement.type === 'stock_in' ? <ArrowUp size={17} /> : movement.type === 'stock_out' ? <ArrowDown size={17} /> : <SlidersHorizontal size={17} />}</div><div><strong>{movement.itemName}</strong><span>{note}</span></div><div className="movement-value"><strong className={positive ? 'positive' : 'negative'}>{positive ? '+' : ''}{formatQuantity(movement.quantity)}</strong><span>{formatTime(movement.createdAt)}</span></div></div>
}

function Inventory({ items, onAdd, onAdjust, onEdit }) {
  const { t, categoryLabel } = useI18n()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const filtered = items.filter((item) => {
    const textMatch = `${item.name} ${item.category} ${item.sku}`.toLowerCase().includes(search.toLowerCase())
    const filterMatch = filter === 'All' || filter === item.category || (filter === 'Low stock' && item.quantity <= item.lowStockThreshold) || (filter === 'For sale' && item.sellable)
    return textMatch && filterMatch
  })
  const presentCategories = categories.filter((category) => items.some((item) => item.category === category))
  return <div className="page enter"><section className="page-heading"><div><span className="eyebrow">{t('allProducts')}</span><h1>{t('inventory')}</h1><p>{t('inventoryDescription')}</p></div><button className="button primary desktop-action" onClick={onAdd}><Plus size={19} /> {t('addProduct')}</button></section>
    <div className="toolbar"><label className="search-box"><Search size={19} /><input aria-label={t('searchPlaceholder')} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('searchPlaceholder')} />{search && <button onClick={() => setSearch('')} aria-label={t('close')}><X size={16} /></button>}</label><div className="filter-scroll"><button className={filter === 'All' ? 'active' : ''} onClick={() => setFilter('All')}>{t('all')} <span>{items.length}</span></button><button className={filter === 'For sale' ? 'active' : ''} onClick={() => setFilter('For sale')}>{t('forSale')} <span>{items.filter((item) => item.sellable).length}</span></button><button className={filter === 'Low stock' ? 'active' : ''} onClick={() => setFilter('Low stock')}>{t('lowStock')} <span>{items.filter((item) => item.quantity <= item.lowStockThreshold).length}</span></button>{presentCategories.map((category) => <button key={category} className={filter === category ? 'active' : ''} onClick={() => setFilter(category)}>{categoryLabel(category)}</button>)}</div></div>
    <section className="card inventory-card">{items.length === 0 ? <EmptyState onAdd={onAdd} /> : filtered.length ? <InventoryList items={filtered} onAdjust={onAdjust} onEdit={onEdit} /> : <div className="empty-state compact"><Search size={28} /><h3>{t('noProductsFound')}</h3><p>{t('noProductsDescription')}</p></div>}</section>
  </div>
}

function SaleList({ sales, onResume, compact = false }) {
  const { t, formatCurrency, formatTime } = useI18n()
  if (!sales.length) return <div className="sales-empty"><ReceiptText size={25} /><span>{t('noSalesYet')}</span></div>
  return <div className={`sales-list ${compact ? 'compact' : ''}`}>{sales.map((sale) => {
    const state = saleState(sale.status, t)
    return <button key={sale.id} disabled={sale.status !== 'pending'} onClick={() => sale.status === 'pending' && onResume(sale)}>
      <div className={`sale-icon ${sale.paymentMethod}`} >{sale.paymentMethod === 'card' ? <CreditCard size={17} /> : <Banknote size={17} />}</div>
      <div className="sale-copy"><strong>#{sale.shortId}</strong><span>{sale.items.length} {sale.items.length === 1 ? t('item') : t('items')} · {formatTime(sale.createdAt)}</span></div>
      <div className="sale-value"><strong>{formatCurrency(sale.total)}</strong><span className={`sale-status ${state.tone}`}>{state.label}</span></div>
      {sale.status === 'pending' && <ChevronRight size={17} />}
    </button>
  })}</div>
}

function CheckoutModal({ checkout, posConfig, onCash, onCard, onRetry, onCancelSale, onClose, busy }) {
  const { t, formatCurrency } = useI18n()
  const sale = checkout.sale
  const pending = checkout.stage === 'processing' || checkout.stage === 'connecting'
  const finalState = sale ? saleState(sale.status, t) : null
  return <Modal title={checkout.stage === 'method' ? t('choosePaymentMethod') : sale ? `#${sale.shortId}` : t('cardPayment')} eyebrow={t('checkout')} onClose={onClose} closeable={!pending}>
    {checkout.stage === 'method' && <div className="checkout-body">
      <div className="checkout-total"><span>{t('totalToPay')}</span><strong>{formatCurrency(checkout.total)}</strong></div>
      <div className="payment-options">
        <button onClick={onCash} disabled={busy}><div className="payment-icon cash"><Banknote size={25} /></div><span><strong>{t('cash')}</strong><small>{t('cashDescription')}</small></span><ChevronRight size={20} /></button>
        <button onClick={onCard} disabled={busy || !posConfig.configured}><div className="payment-icon card"><CreditCard size={25} /></div><span><strong>{t('card')}</strong><small>{posConfig.configured ? t('pointSmart2Description') : t('pointNotConfigured')}</small></span><ChevronRight size={20} /></button>
      </div>
      {!posConfig.configured && <div className="setup-hint"><AlertTriangle size={17} /><span>{t('pointSetupHint')}</span></div>}
    </div>}
    {(checkout.stage === 'connecting' || checkout.stage === 'processing') && <div className="payment-progress">
      <div className="terminal-animation"><CreditCard size={31} /><i /><i /><i /></div>
      <h3>{checkout.stage === 'connecting' ? t('sendingToPoint') : t('followPointInstructions')}</h3>
      <p>{checkout.stage === 'connecting' ? t('connectingPointDescription') : t('customerUseTerminal')}</p>
      {sale && <div className="payment-reference"><span>{t('sale')}</span><strong>#{sale.shortId}</strong><span>{formatCurrency(sale.total)}</span></div>}
      <div className="progress-line"><i /></div>
      {sale?.mpStatus === 'action_required' && <div className="setup-hint"><AlertTriangle size={17} />{t('checkTerminal')}</div>}
      {sale?.mpOrderId && <button className="text-button danger-text" onClick={onCancelSale} disabled={busy}>{t('cancelPayment')}</button>}
    </div>}
    {checkout.stage === 'connection-error' && <div className="payment-result error">
      <div><Wifi size={28} /></div><h3>{t('connectionUncertain')}</h3><p>{checkout.error}</p>
      <div className="result-actions"><button className="button secondary" onClick={onClose}>{t('close')}</button><button className="button primary" onClick={onRetry} disabled={busy}><RotateCw size={18} />{t('retryConnection')}</button></div>
    </div>}
    {checkout.stage === 'error' && <div className="payment-result error">
      <div><X size={29} /></div><h3>{finalState?.label || t('paymentCouldNotStart')}</h3><p>{checkout.error || t('stockRestored')}</p>
      <button className="button primary" onClick={onClose}>{t('returnToCart')}</button>
    </div>}
    {checkout.stage === 'success' && <div className="payment-result success">
      <div><BadgeCheck size={34} /></div><h3>{t('paymentApproved')}</h3><p>{sale?.paymentMethod === 'card' ? t('cardSaleCompleted') : t('cashSaleCompleted')}</p>
      <div className="success-total"><span>#{sale?.shortId}</span><strong>{formatCurrency(sale?.total || 0)}</strong></div>
      <button className="button primary" onClick={onClose}>{t('newSale')}</button>
    </div>}
  </Modal>
}

function SalesCounter({ items, sales, posConfig, onRefresh, setToast }) {
  const { t, categoryLabel, unitLabel, formatCurrency } = useI18n()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const [cart, setCart] = useState([])
  const [checkout, setCheckout] = useState(null)
  const [busy, setBusy] = useState(false)
  const sellable = useMemo(() => items.filter((item) => item.sellable && item.price > 0), [items])
  const presentCategories = categories.filter((category) => sellable.some((item) => item.category === category))
  const products = sellable.filter((item) => (filter === 'All' || item.category === filter) && `${item.name} ${item.sku}`.toLowerCase().includes(search.toLowerCase()))
  const cartLines = cart.map((line) => ({ ...line, item: items.find((item) => item.id === line.itemId) })).filter((line) => line.item)
  const total = cartLines.reduce((sum, line) => sum + Math.round(line.item.price * line.quantity), 0)
  const count = cartLines.reduce((sum, line) => sum + line.quantity, 0)

  const changeQuantity = (item, delta) => setCart((current) => {
    const existing = current.find((line) => line.itemId === item.id)
    const next = Math.max(0, Math.min(item.quantity, (existing?.quantity || 0) + delta))
    if (!existing && next > 0) return [...current, { itemId: item.id, quantity: next }]
    if (next === 0) return current.filter((line) => line.itemId !== item.id)
    return current.map((line) => line.itemId === item.id ? { ...line, quantity: next } : line)
  })
  const payload = () => cartLines.map((line) => ({ itemId: line.itemId, quantity: line.quantity }))
  const finish = async (sale) => {
    setCheckout((current) => ({ ...current, stage: sale.status === 'paid' ? 'success' : 'error', sale, error: sale.status === 'paid' ? '' : t('stockRestored') }))
    if (sale.status === 'paid') setCart([])
    await onRefresh()
  }
  const payCash = async () => {
    setBusy(true)
    try { await finish(await api.cashSale(payload())) } catch (error) { setCheckout((current) => ({ ...current, stage: 'error', error: error.message })) } finally { setBusy(false) }
  }
  const payCard = async () => {
    setBusy(true); setCheckout((current) => ({ ...current, stage: 'connecting' }))
    try {
      const sale = await api.cardSale(payload())
      setCheckout((current) => ({ ...current, stage: 'processing', sale }))
      await onRefresh()
    } catch (error) {
      const sale = error.saleId && error.uncertain ? { id: error.saleId, shortId: error.saleId.replaceAll('-', '').slice(0, 8).toUpperCase(), total, status: 'pending' } : null
      setCheckout((current) => ({ ...current, stage: error.uncertain ? 'connection-error' : 'error', sale, error: error.message }))
      await onRefresh().catch(() => {})
    } finally { setBusy(false) }
  }
  const retry = async () => {
    if (!checkout.sale?.id) return
    setBusy(true)
    try { const sale = await api.retryCardSale(checkout.sale.id); setCheckout((current) => ({ ...current, stage: 'processing', sale, error: '' })) }
    catch (error) { setCheckout((current) => ({ ...current, stage: error.uncertain ? 'connection-error' : 'error', error: error.message })) }
    finally { setBusy(false) }
  }
  const cancelSale = async () => {
    if (!checkout.sale?.id) return
    setBusy(true)
    try { await finish(await api.cancelSale(checkout.sale.id)) }
    catch (error) { setToast({ type: 'error', message: error.message }) }
    finally { setBusy(false) }
  }
  const checkPoint = async () => {
    try {
      const terminal = await api.terminal()
      setToast({ type: terminal.connected ? 'success' : 'error', message: terminal.connected ? t('pointReady', { id: terminal.label || '' }) : t('pointNeedsPdv') })
    } catch (error) { setToast({ type: 'error', message: error.message }) }
  }

  useEffect(() => {
    if (checkout?.stage !== 'processing' || !checkout.sale?.id) return undefined
    let active = true
    const poll = async () => {
      try {
        const sale = await api.sale(checkout.sale.id, true)
        if (!active) return
        setCheckout((current) => ({ ...current, sale }))
        if (sale.status !== 'pending') await finish(sale)
      } catch (error) {
        if (active) setToast({ type: 'error', message: error.message })
      }
    }
    const id = setInterval(poll, 2500)
    poll()
    return () => { active = false; clearInterval(id) }
  }, [checkout?.stage, checkout?.sale?.id])

  return <div className="page pos-page enter">
    <section className="page-heading pos-heading"><div><span className="eyebrow">{t('counterMode')}</span><h1>{t('salesCounter')}</h1><p>{t('salesDescription')}</p></div><button className={`terminal-chip ${posConfig.configured ? 'ready' : ''}`} onClick={checkPoint} disabled={!posConfig.configured}><Wifi size={16} /><span>{posConfig.mockMode ? t('pointDemoMode') : posConfig.configured ? `Point · ${posConfig.terminalLabel}` : t('pointOffline')}</span></button></section>
    <section className="pos-layout">
      <div className="catalog-panel">
        <div className="toolbar pos-toolbar"><label className="search-box"><Search size={19} /><input aria-label={t('searchProducts')} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('searchProducts')} />{search && <button onClick={() => setSearch('')} aria-label={t('close')}><X size={16} /></button>}</label><div className="filter-scroll"><button className={filter === 'All' ? 'active' : ''} onClick={() => setFilter('All')}>{t('all')}</button>{presentCategories.map((category) => <button key={category} className={filter === category ? 'active' : ''} onClick={() => setFilter(category)}>{categoryLabel(category)}</button>)}</div></div>
        {sellable.length === 0 ? <div className="card pos-empty"><div className="empty-art"><ReceiptText size={31} /></div><h3>{t('configureProductsForSale')}</h3><p>{t('configureProductsDescription')}</p></div> : products.length ? <div className="product-grid">{products.map((item) => {
          const inCart = cart.find((line) => line.itemId === item.id)?.quantity || 0
          return <button key={item.id} className="sale-product" disabled={item.quantity <= 0 || inCart >= item.quantity} onClick={() => changeQuantity(item, 1)}>
            <div className="sale-product-top"><div className="product-glyph"><Croissant size={20} /></div>{inCart > 0 && <span className="cart-badge">{formatQuantity(inCart)}</span>}</div>
            <strong>{item.name}</strong><span>{formatQuantity(item.quantity)} {unitLabel(item.unit)} {t('availableLower')}</span><b>{formatCurrency(item.price)}</b>
            {item.quantity <= 0 ? <i>{t('outOfStock')}</i> : <Plus size={17} />}
          </button>
        })}</div> : <div className="pos-empty compact"><Search size={27} /><h3>{t('noProductsFound')}</h3></div>}
        <section className="card recent-sales"><header className="card-header"><div><span className="eyebrow">{t('todayAndRecent')}</span><h2>{t('recentSales')}</h2></div></header><SaleList sales={sales.slice(0, 6)} onResume={(sale) => setCheckout({ stage: sale.mpOrderId ? 'processing' : 'connection-error', sale, total: sale.total, error: sale.mpOrderId ? '' : t('reservedSaleRecovery') })} compact /></section>
      </div>
      <aside className={`cart-panel ${cartLines.length ? 'has-items' : ''}`}>
        <header><div><ShoppingBasket size={20} /><div><span className="eyebrow">{t('currentOrder')}</span><h2>{t('cart')}</h2></div></div>{cartLines.length > 0 && <button onClick={() => setCart([])}>{t('clear')}</button>}</header>
        {cartLines.length ? <div className="cart-lines">{cartLines.map(({ item, quantity }) => <article key={item.id}><div className="cart-line-main"><div><strong>{item.name}</strong><span>{formatCurrency(item.price)} · {unitLabel(item.unit)}</span></div><b>{formatCurrency(item.price * quantity)}</b></div><div className="quantity-stepper"><button onClick={() => changeQuantity(item, -1)} aria-label={t('removeOne')}><Minus size={16} /></button><span>{formatQuantity(quantity)}</span><button onClick={() => changeQuantity(item, 1)} disabled={quantity >= item.quantity} aria-label={t('addOne')}><Plus size={16} /></button><button className="remove-line" onClick={() => changeQuantity(item, -quantity)} aria-label={t('removeFromCart')}><Trash2 size={16} /></button></div></article>)}</div> : <div className="cart-empty"><div><ShoppingBasket size={28} /></div><h3>{t('emptyCart')}</h3><p>{t('tapProducts')}</p></div>}
        <footer><div className="cart-summary"><span>{t('productsCount', { count: formatQuantity(count) })}</span><div><span>{t('total')}</span><strong>{formatCurrency(total)}</strong></div></div><button className="button primary pay-button" disabled={!cartLines.length} onClick={() => setCheckout({ stage: 'method', total })}>{t('charge')}<ArrowRight size={19} /></button></footer>
      </aside>
    </section>
    {checkout && <CheckoutModal checkout={checkout} posConfig={posConfig} onCash={payCash} onCard={payCard} onRetry={retry} onCancelSale={cancelSale} onClose={() => setCheckout(null)} busy={busy} />}
  </div>
}

function Activity({ movements }) {
  const { t, formatDate } = useI18n()
  const grouped = movements.reduce((acc, movement) => {
    const key = new Date(movement.createdAt).toDateString()
    acc[key] = [...(acc[key] || []), movement]
    return acc
  }, {})
  return <div className="page enter"><section className="page-heading"><div><span className="eyebrow">{t('activityTrail')}</span><h1>{t('activity')}</h1><p>{t('activityDescription')}</p></div></section><section className="card history-card">{movements.length ? Object.entries(grouped).map(([day, entries]) => <div className="history-group" key={day}><h3>{new Date(day).toDateString() === new Date().toDateString() ? t('today') : formatDate(new Date(day))}</h3><div>{entries.map((movement) => <Movement movement={movement} key={movement.id} />)}</div></div>) : <div className="empty-state compact"><History size={30} /><h3>{t('noActivity')}</h3><p>{t('noActivityDescription')}</p></div>}</section></div>
}

export default function App() {
  const { t, formatDate } = useI18n()
  const [page, setPage] = useState('dashboard')
  const [items, setItems] = useState([])
  const [movements, setMovements] = useState([])
  const [sales, setSales] = useState([])
  const [posConfig, setPosConfig] = useState({ configured: false, mockMode: false, terminalLabel: '' })
  const [auth, setAuth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [mobileMenu, setMobileMenu] = useState(false)

  const refresh = useCallback(async () => {
    const [nextItems, nextMovements, nextSales, nextPosConfig] = await Promise.all([api.items(), api.movements(), api.sales(), api.posConfig()])
    setItems(nextItems); setMovements(nextMovements); setSales(nextSales); setPosConfig(nextPosConfig)
  }, [])
  useEffect(() => {
    api.authStatus().then(async (status) => {
      setAuth(status)
      if (status.authenticated) await refresh()
    }).catch((error) => setToast({ type: 'error', message: error.message })).finally(() => setLoading(false))
  }, [refresh])
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 4200); return () => clearTimeout(id) }, [toast])

  const handleLogin = async (pin) => {
    const status = await api.login(pin)
    setAuth(status); setLoading(true)
    try { await refresh() } finally { setLoading(false) }
  }
  const handleLogout = async () => { await api.logout(); setAuth({ ...auth, authenticated: false }); setItems([]); setSales([]); setMovements([]) }
  const perform = async (action, message) => {
    setBusy(true)
    try { await action(); await refresh(); setModal(null); setToast({ type: 'success', message }) }
    catch (error) {
      if (error.status === 401) setAuth((current) => ({ ...current, authenticated: false }))
      setToast({ type: 'error', message: error.message })
    } finally { setBusy(false) }
  }
  const addItem = (form) => perform(() => api.createItem(form), t('productAdded', { name: form.name }))
  const editItem = (item, form) => perform(() => api.updateItem(item.id, form), t('productUpdated', { name: form.name }))
  const deleteItem = (item) => perform(() => api.deleteItem(item.id), t('productDeleted', { name: item.name }))
  const adjustItem = (item, form) => perform(() => api.adjustItem(item.id, form), t('stockUpdated', { name: item.name }))
  const nav = [
    { id: 'dashboard', label: t('overview'), icon: LayoutDashboard },
    { id: 'pos', label: t('sales'), icon: ShoppingBasket },
    { id: 'inventory', label: t('inventory'), icon: Boxes },
    { id: 'activity', label: t('activity'), icon: History },
  ]
  const pageTitle = nav.find((entry) => entry.id === page)?.label

  if (loading && !auth) return <div className="loading full"><div className="loader-mark"><Croissant size={28} /></div><span>{t('preparing')}</span></div>
  if (auth?.required && !auth.authenticated) return <LoginScreen onLogin={handleLogin} />

  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Croissant size={24} /></div><div><strong>Bakery POS</strong><span>{t('brandSubtitle')}</span></div></div>
      <nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => { setPage(id); setMobileMenu(false) }}><Icon size={20} /><span>{label}</span>{page === id && <i />}</button>)}</nav>
      <div className="sidebar-note"><div><Sparkles size={18} /></div><strong>{t('freshnessFirst')}</strong><p>{t('freshnessDescription')}</p></div>
      <div className="sidebar-footer"><span className="online-dot" />{t('allChangesSaved')}{auth?.required && <button onClick={handleLogout} aria-label={t('signOut')}><LogOut size={15} /></button>}</div>
    </aside>
    {mobileMenu && <button className="menu-backdrop" onClick={() => setMobileMenu(false)} aria-label={t('close')} />}
    <main className="main-content">
      <header className="topbar"><button className="icon-button menu-button" onClick={() => setMobileMenu(true)} aria-label={t('openMenu')}><Menu size={21} /></button><div><span>Bakery POS</span><strong>{pageTitle}</strong></div><LanguageToggle />{page !== 'pos' && <button className="button primary mobile-add" onClick={() => setModal({ type: 'add' })}><Plus size={20} /><span>{t('add')}</span></button>}<div className="date-chip"><Clock3 size={17} /><span>{formatDate(new Date().toISOString().slice(0, 10))}</span></div></header>
      {loading ? <div className="loading"><div className="loader-mark"><Croissant size={28} /></div><span>{t('preparing')}</span></div> : <>
        {page === 'dashboard' && <Dashboard items={items} movements={movements} sales={sales} onAdd={() => setModal({ type: 'add' })} onAdjust={(item) => setModal({ type: 'adjust', item })} onGoInventory={() => setPage('inventory')} onGoPos={() => setPage('pos')} />}
        {page === 'pos' && <SalesCounter items={items} sales={sales} posConfig={posConfig} onRefresh={refresh} setToast={setToast} />}
        {page === 'inventory' && <Inventory items={items} onAdd={() => setModal({ type: 'add' })} onAdjust={(item) => setModal({ type: 'adjust', item })} onEdit={(item) => setModal({ type: 'edit', item })} />}
        {page === 'activity' && <Activity movements={movements} />}
      </>}
    </main>
    <nav className="bottom-nav">{nav.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}><Icon size={20} /><span>{label}</span></button>)}</nav>
    {modal?.type === 'add' && <Modal title={t('addProduct')} eyebrow={t('inventorySetup')} onClose={() => setModal(null)}><ProductForm onSubmit={addItem} onClose={() => setModal(null)} busy={busy} /></Modal>}
    {modal?.type === 'edit' && <Modal title={modal.item.name} eyebrow={t('productDetails')} onClose={() => setModal(null)}><ProductForm item={modal.item} onSubmit={(form) => editItem(modal.item, form)} onDelete={() => deleteItem(modal.item)} onClose={() => setModal(null)} busy={busy} /></Modal>}
    {modal?.type === 'adjust' && <Modal title={modal.item.name} eyebrow={t('updateStock')} onClose={() => setModal(null)}><AdjustForm item={modal.item} onSubmit={(form) => adjustItem(modal.item, form)} onClose={() => setModal(null)} busy={busy} /></Modal>}
    {toast && <div className={`toast ${toast.type}`} role="status"><div>{toast.type === 'success' ? <Check size={18} /> : <AlertTriangle size={18} />}</div><span>{toast.message}</span><button onClick={() => setToast(null)} aria-label={t('close')}><X size={16} /></button></div>}
  </div>
}
