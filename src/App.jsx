import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowRight, ArrowUp, BarChart3, Boxes, CalendarClock,
  Check, ChevronRight, CirclePlus, Clock3, Croissant, History, LayoutDashboard,
  Menu, Minus, PackageOpen, Pencil, Plus, Search, SlidersHorizontal, Sparkles, X,
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

function LanguageToggle() {
  const { language, setLanguage, t } = useI18n()
  return <div className="language-toggle" role="group" aria-label={t('language')}>
    <button className={language === 'es' ? 'active' : ''} onClick={() => setLanguage('es')} aria-pressed={language === 'es'}>ES</button>
    <button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')} aria-pressed={language === 'en'}>EN</button>
  </div>
}

function Modal({ title, eyebrow, onClose, children, wide = false }) {
  const { t } = useI18n()
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.classList.add('modal-open')
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open') }
  }, [onClose])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-handle" />
        <header className="modal-header">
          <div><span className="eyebrow">{eyebrow}</span><h2 id="modal-title">{title}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label={t('close')}><X size={20} /></button>
        </header>
        {children}
      </section>
    </div>
  )
}

function ProductForm({ item, onSubmit, onClose, busy }) {
  const { t, categoryLabel, unitLabel } = useI18n()
  const [form, setForm] = useState({
    name: item?.name || '', category: item?.category || 'Bread', unit: item?.unit || 'pieces',
    quantity: item?.quantity ?? '', lowStockThreshold: item?.lowStockThreshold ?? '',
    sku: item?.sku || '', expiryDate: item?.expiryDate?.slice(0, 10) || '',
  })
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const submit = (event) => { event.preventDefault(); onSubmit(form) }

  return (
    <form onSubmit={submit} className="form-stack">
      <div className="field full"><label htmlFor="name">{t('productName')}</label><input id="name" autoFocus required value={form.name} onChange={update('name')} placeholder={t('productNamePlaceholder')} /></div>
      <div className="form-grid">
        <div className="field"><label htmlFor="category">{t('category')}</label><select id="category" value={form.category} onChange={update('category')}>{categories.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}</select></div>
        <div className="field"><label htmlFor="unit">{t('measuredIn')}</label><select id="unit" value={form.unit} onChange={update('unit')}>{units.map((unit) => <option key={unit} value={unit}>{unitLabel(unit)}</option>)}</select></div>
        {!item && <div className="field"><label htmlFor="quantity">{t('openingQuantity')}</label><input id="quantity" type="number" min="0" step="0.01" required value={form.quantity} onChange={update('quantity')} placeholder="0" /></div>}
        <div className="field"><label htmlFor="threshold">{t('lowStockAlert')}</label><input id="threshold" type="number" min="0" step="0.01" required value={form.lowStockThreshold} onChange={update('lowStockThreshold')} placeholder="0" /></div>
        <div className="field"><label htmlFor="expiry">{t('expiryDate')} <span>{t('optional')}</span></label><input id="expiry" type="date" value={form.expiryDate} onChange={update('expiryDate')} /></div>
        <div className="field"><label htmlFor="sku">{t('sku')} <span>{t('optional')}</span></label><input id="sku" value={form.sku} onChange={update('sku')} placeholder={t('skuPlaceholder')} /></div>
      </div>
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>{t('cancel')}</button><button className="button primary" disabled={busy}>{busy ? t('saving') : item ? t('saveChanges') : t('addProduct')}<Check size={18} /></button></div>
    </form>
  )
}

function AdjustForm({ item, initialType = 'stock_in', onSubmit, onClose, busy }) {
  const { t, unitLabel } = useI18n()
  const [type, setType] = useState(initialType)
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const newBalance = type === 'adjustment' ? Number(quantity || item.quantity)
    : Math.max(0, item.quantity + (type === 'stock_in' ? 1 : -1) * Number(quantity || 0))

  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit({ type, quantity, note }) }} className="form-stack">
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
  )
}

function EmptyState({ onAdd }) {
  const { t } = useI18n()
  return <div className="empty-state"><div className="empty-art"><PackageOpen size={32} /></div><h3>{t('shelvesReady')}</h3><p>{t('emptyInventoryDescription')}</p><button className="button primary" onClick={onAdd}><Plus size={18} /> {t('addFirstProduct')}</button></div>
}

function InventoryList({ items, onAdjust, onEdit }) {
  const { t, categoryLabel, unitLabel, formatDate } = useI18n()
  return (
    <div className="inventory-list">
      <div className="inventory-head"><span>{t('product')}</span><span>{t('available')}</span><span>{t('status')}</span><span>{t('expiry')}</span><span aria-hidden="true" /></div>
      {items.map((item) => {
        const state = stockState(item, t); const expiry = daysUntil(item.expiryDate)
        return <article className="inventory-row" key={item.id}>
          <div className="product-cell"><div className={`product-glyph category-${item.category.toLowerCase()}`}><Croissant size={20} /></div><div><strong>{item.name}</strong><span>{categoryLabel(item.category)}{item.sku ? ` · ${item.sku}` : ''}</span></div></div>
          <div className="quantity-cell"><strong>{formatQuantity(item.quantity)}</strong><span>{unitLabel(item.unit)}</span></div>
          <div><span className={`status ${state.tone}`}><i />{state.label}</span></div>
          <div className={`expiry-cell ${expiry !== null && expiry <= 2 ? 'urgent' : ''}`}>{item.expiryDate ? <><CalendarClock size={16} /><span>{expiry < 0 ? t('expired') : expiry === 0 ? t('todayExpiry') : formatDate(item.expiryDate)}</span></> : <span>—</span>}</div>
          <div className="row-actions"><button className="button compact" onClick={() => onAdjust(item)}>{t('updateStockButton')}</button><button className="icon-button subtle" onClick={() => onEdit(item)} aria-label={`${t('productDetails')}: ${item.name}`}><Pencil size={17} /></button></div>
        </article>
      })}
    </div>
  )
}

function Dashboard({ items, movements, onAdd, onAdjust, onGoInventory }) {
  const { t, categoryLabel, unitLabel } = useI18n()
  const lowItems = items.filter((item) => item.quantity <= item.lowStockThreshold)
  const expiring = items.filter((item) => { const days = daysUntil(item.expiryDate); return days !== null && days >= 0 && days <= 3 })
  const units = items.reduce((sum, item) => sum + Number(item.quantity), 0)
  const categoriesData = Object.entries(items.reduce((acc, item) => ({ ...acc, [item.category]: (acc[item.category] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])
  const maxCategory = Math.max(...categoriesData.map(([, value]) => value), 1)

  const greetingKey = new Date().getHours() < 12 ? 'greetingMorning' : new Date().getHours() < 18 ? 'greetingAfternoon' : 'greetingEvening'
  return <div className="page enter">
    <section className="welcome-row"><div><span className="eyebrow">{t('liveInventory')}</span><h1>{t(greetingKey)}</h1><p>{t('welcomeMessage')}</p></div><button className="button primary desktop-action" onClick={onAdd}><CirclePlus size={19} /> {t('addProduct')}</button></section>

    <section className="metrics" aria-label={t('inventorySummary')}>
      <div className="metric-card"><div className="metric-icon cocoa"><Boxes size={20} /></div><div><span>{t('products')}</span><strong>{items.length}</strong><small>{t('acrossCategories', { count: categoriesData.length })}</small></div></div>
      <div className="metric-card"><div className="metric-icon sage"><BarChart3 size={20} /></div><div><span>{t('unitsOnHand')}</span><strong>{formatQuantity(units)}</strong><small>{t('currentRecordedTotal')}</small></div></div>
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
  const note = movement.note === 'Opening stock' ? t('openingStock') : movement.note || (movement.type === 'stock_in' ? t('stockReceived') : movement.type === 'stock_out' ? t('stockRemoved') : t('countCorrected'))
  return <div className="activity-item"><div className={`movement-icon ${movement.type}`}>{movement.type === 'stock_in' ? <ArrowUp size={17} /> : movement.type === 'stock_out' ? <ArrowDown size={17} /> : <SlidersHorizontal size={17} />}</div><div><strong>{movement.itemName}</strong><span>{note}</span></div><div className="movement-value"><strong className={positive ? 'positive' : 'negative'}>{positive ? '+' : ''}{formatQuantity(movement.quantity)}</strong><span>{formatTime(movement.createdAt)}</span></div></div>
}

function Inventory({ items, onAdd, onAdjust, onEdit }) {
  const { t, categoryLabel } = useI18n()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const filtered = items.filter((item) => {
    const textMatch = `${item.name} ${item.category} ${item.sku}`.toLowerCase().includes(search.toLowerCase())
    const filterMatch = filter === 'All' || filter === item.category || (filter === 'Low stock' && item.quantity <= item.lowStockThreshold)
    return textMatch && filterMatch
  })
  const presentCategories = categories.filter((category) => items.some((item) => item.category === category))

  return <div className="page enter"><section className="page-heading"><div><span className="eyebrow">{t('allProducts')}</span><h1>{t('inventory')}</h1><p>{t('inventoryDescription')}</p></div><button className="button primary desktop-action" onClick={onAdd}><Plus size={19} /> {t('addProduct')}</button></section>
    <div className="toolbar"><label className="search-box"><Search size={19} /><input aria-label={t('searchPlaceholder')} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('searchPlaceholder')} />{search && <button onClick={() => setSearch('')} aria-label={t('close')}><X size={16} /></button>}</label><div className="filter-scroll"><button className={filter === 'All' ? 'active' : ''} onClick={() => setFilter('All')}>{t('all')} <span>{items.length}</span></button><button className={filter === 'Low stock' ? 'active' : ''} onClick={() => setFilter('Low stock')}>{t('lowStock')} <span>{items.filter((item) => item.quantity <= item.lowStockThreshold).length}</span></button>{presentCategories.map((category) => <button key={category} className={filter === category ? 'active' : ''} onClick={() => setFilter(category)}>{categoryLabel(category)}</button>)}</div></div>
    <section className="card inventory-card">{items.length === 0 ? <EmptyState onAdd={onAdd} /> : filtered.length ? <InventoryList items={filtered} onAdjust={onAdjust} onEdit={onEdit} /> : <div className="empty-state compact"><Search size={28} /><h3>{t('noProductsFound')}</h3><p>{t('noProductsDescription')}</p></div>}</section>
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
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [mobileMenu, setMobileMenu] = useState(false)

  const refresh = async () => {
    const [nextItems, nextMovements] = await Promise.all([api.items(), api.movements()])
    setItems(nextItems); setMovements(nextMovements)
  }
  useEffect(() => { refresh().catch((error) => setToast({ type: 'error', message: error.message })).finally(() => setLoading(false)) }, [])
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 3500); return () => clearTimeout(id) }, [toast])

  const perform = async (action, message) => {
    setBusy(true)
    try { await action(); await refresh(); setModal(null); setToast({ type: 'success', message }) }
    catch (error) { setToast({ type: 'error', message: error.message }) }
    finally { setBusy(false) }
  }
  const addItem = (form) => perform(() => api.createItem(form), t('productAdded', { name: form.name }))
  const editItem = (item, form) => perform(() => api.updateItem(item.id, form), t('productUpdated', { name: form.name }))
  const adjustItem = (item, form) => perform(() => api.adjustItem(item.id, form), t('stockUpdated', { name: item.name }))
  const nav = [{ id: 'dashboard', label: t('overview'), icon: LayoutDashboard }, { id: 'inventory', label: t('inventory'), icon: Boxes }, { id: 'activity', label: t('activity'), icon: History }]
  const pageTitle = nav.find((entry) => entry.id === page)?.label

  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Croissant size={24} /></div><div><strong>Bakery Stock</strong><span>{t('brandSubtitle')}</span></div></div>
      <nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => { setPage(id); setMobileMenu(false) }}><Icon size={20} /><span>{label}</span>{page === id && <i />}</button>)}</nav>
      <div className="sidebar-note"><div><Sparkles size={18} /></div><strong>{t('freshnessFirst')}</strong><p>{t('freshnessDescription')}</p></div>
      <div className="sidebar-footer"><span className="online-dot" />{t('allChangesSaved')}</div>
    </aside>
    {mobileMenu && <button className="menu-backdrop" onClick={() => setMobileMenu(false)} aria-label="Close menu" />}
    <main className="main-content">
      <header className="topbar"><button className="icon-button menu-button" onClick={() => setMobileMenu(true)} aria-label={t('openMenu')}><Menu size={21} /></button><div><span>Bakery Stock</span><strong>{pageTitle}</strong></div><LanguageToggle /><button className="button primary mobile-add" onClick={() => setModal({ type: 'add' })}><Plus size={20} /><span>{t('add')}</span></button><div className="date-chip"><Clock3 size={17} /><span>{formatDate(new Date().toISOString().slice(0, 10))}</span></div></header>
      {loading ? <div className="loading"><div className="loader-mark"><Croissant size={28} /></div><span>{t('preparing')}</span></div> : <>
        {page === 'dashboard' && <Dashboard items={items} movements={movements} onAdd={() => setModal({ type: 'add' })} onAdjust={(item) => setModal({ type: 'adjust', item })} onGoInventory={() => setPage('inventory')} />}
        {page === 'inventory' && <Inventory items={items} onAdd={() => setModal({ type: 'add' })} onAdjust={(item) => setModal({ type: 'adjust', item })} onEdit={(item) => setModal({ type: 'edit', item })} />}
        {page === 'activity' && <Activity movements={movements} />}
      </>}
    </main>
    <nav className="bottom-nav">{nav.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}><Icon size={20} /><span>{label}</span></button>)}</nav>
    {modal?.type === 'add' && <Modal title={t('addProduct')} eyebrow={t('inventorySetup')} onClose={() => setModal(null)}><ProductForm onSubmit={addItem} onClose={() => setModal(null)} busy={busy} /></Modal>}
    {modal?.type === 'edit' && <Modal title={modal.item.name} eyebrow={t('productDetails')} onClose={() => setModal(null)}><ProductForm item={modal.item} onSubmit={(form) => editItem(modal.item, form)} onClose={() => setModal(null)} busy={busy} /></Modal>}
    {modal?.type === 'adjust' && <Modal title={modal.item.name} eyebrow={t('updateStock')} onClose={() => setModal(null)}><AdjustForm item={modal.item} onSubmit={(form) => adjustItem(modal.item, form)} onClose={() => setModal(null)} busy={busy} /></Modal>}
    {toast && <div className={`toast ${toast.type}`} role="status"><div>{toast.type === 'success' ? <Check size={18} /> : <AlertTriangle size={18} />}</div><span>{toast.message}</span><button onClick={() => setToast(null)} aria-label={t('close')}><X size={16} /></button></div>}
  </div>
}
