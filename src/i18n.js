import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react'

const LanguageContext = createContext(null)
const supportedLanguages = ['es', 'en']

const dictionaries = {
  es: {
    brandSubtitle: 'Panel de mostrador', language: 'Idioma', openMenu: 'Abrir menú', preparing: 'Preparando tu panel…',
    overview: 'Resumen', inventory: 'Inventario', activity: 'Actividad',
    liveInventory: 'Inventario en vivo', greetingMorning: 'Buenos días.', greetingAfternoon: 'Buenas tardes.', greetingEvening: 'Buenas noches.',
    welcomeMessage: 'Esto es lo que está pasando en tu panadería hoy.', addProduct: 'Agregar producto', add: 'Agregar',
    inventorySummary: 'Resumen del inventario', products: 'Productos', acrossCategories: 'En {count} categorías',
    unitsOnHand: 'Unidades disponibles', currentRecordedTotal: 'Total registrado', needAttention: 'Requieren atención',
    atOrBelowMinimum: 'En o bajo el mínimo', everythingHealthy: 'Todo se ve bien', expiringSoon: 'Próximos a vencer',
    next3Days: 'En los próximos 3 días', inventoryHealth: 'Salud del inventario', stockRequiringAttention: 'Stock que requiere atención',
    viewAll: 'Ver todo', everythingStocked: 'Todo está abastecido', noBelowAlert: 'No hay productos bajo su nivel de alerta.',
    productMix: 'Mezcla de productos', byCategory: 'Por categoría', categoriesEmpty: 'Las categorías aparecerán al agregar productos.',
    latestChanges: 'Últimos cambios', recentActivity: 'Actividad reciente', stockActivityEmpty: 'La actividad del stock aparecerá aquí.',
    allProducts: 'Todos los productos', inventoryDescription: 'Busca, revisa y actualiza todo lo que tienes en tus estantes.',
    searchPlaceholder: 'Buscar productos o SKU', all: 'Todos', lowStock: 'Stock bajo',
    activityTrail: 'Historial de cambios', activityDescription: 'Cada entrada, salida y corrección en un solo lugar.', today: 'Hoy',
    noActivity: 'Aún no hay actividad', noActivityDescription: 'Tus entradas, salidas y correcciones aparecerán aquí.',
    product: 'Producto', available: 'Disponible', status: 'Estado', expiry: 'Vencimiento',
    inStock: 'En stock', outOfStock: 'Agotado', lowStockStatus: 'Stock bajo', expired: 'Vencido', todayExpiry: 'Hoy',
    inventorySetup: 'Configuración del inventario', productDetails: 'Detalles del producto', updateStock: 'Actualizar stock', close: 'Cerrar',
    productName: 'Nombre del producto', productNamePlaceholder: 'ej. Croissant de mantequilla', category: 'Categoría', measuredIn: 'Medido en',
    openingQuantity: 'Cantidad inicial', lowStockAlert: 'Alerta de stock bajo', expiryDate: 'Fecha de vencimiento', sku: 'SKU o código',
    optional: 'Opcional', skuPlaceholder: 'PAN-001', cancel: 'Cancelar', saving: 'Guardando…', saveChanges: 'Guardar cambios',
    currentBalance: 'Saldo actual', stockAction: 'Acción de stock', stockIn: 'Entrada', stockOut: 'Salida', setCount: 'Fijar cantidad',
    newTotalQuantity: 'Nueva cantidad total', quantity: 'Cantidad', balanceAfterUpdate: 'Saldo después de actualizar', note: 'Nota',
    notePlaceholder: 'Entrega, venta, merma…', updating: 'Actualizando…', updateStockButton: 'Actualizar stock',
    shelvesReady: 'Tus estantes están listos', emptyInventoryDescription: 'Agrega tu primer producto para comenzar a controlar stock, entregas y alertas.',
    addFirstProduct: 'Agregar primer producto', noProductsFound: 'No encontramos productos', noProductsDescription: 'Prueba con otra búsqueda o categoría.',
    stockReceived: 'Stock recibido', stockRemoved: 'Stock retirado', countCorrected: 'Cantidad corregida',
    openingStock: 'Stock inicial', minimum: 'mínimo', allChangesSaved: 'Todos los cambios guardados', freshnessFirst: 'Primero la frescura',
    freshnessDescription: 'Mantén las cantidades al día para tomar mejores decisiones de producción.',
    productAdded: '{name} se agregó al inventario.', productUpdated: '{name} se actualizó.', stockUpdated: 'El stock de {name} se actualizó.',
    units: { pieces: 'unidades', loaves: 'panes', cakes: 'tortas', kg: 'kg', g: 'g', litres: 'litros', bottles: 'botellas', boxes: 'cajas', packs: 'paquetes' },
    categories: { Bread: 'Pan', Pastries: 'Pastelería', Cakes: 'Tortas', Ingredients: 'Ingredientes', Packaging: 'Embalaje', Drinks: 'Bebidas', Other: 'Otro' },
  },
  en: {
    brandSubtitle: 'Counter dashboard', language: 'Language', openMenu: 'Open menu', preparing: 'Preparing your dashboard…', overview: 'Overview', inventory: 'Inventory', activity: 'Activity',
    liveInventory: 'Live inventory', greetingMorning: 'Good morning.', greetingAfternoon: 'Good afternoon.', greetingEvening: 'Good evening.',
    welcomeMessage: 'Here’s what’s happening across your bakery today.', addProduct: 'Add product', add: 'Add',
    inventorySummary: 'Inventory summary', products: 'Products', acrossCategories: 'Across {count} categories',
    unitsOnHand: 'Units on hand', currentRecordedTotal: 'Current recorded total', needAttention: 'Need attention',
    atOrBelowMinimum: 'At or below minimum', everythingHealthy: 'Everything looks healthy', expiringSoon: 'Expiring soon',
    next3Days: 'Within the next 3 days', inventoryHealth: 'Inventory health', stockRequiringAttention: 'Stock requiring attention',
    viewAll: 'View all', everythingStocked: 'Everything looks stocked', noBelowAlert: 'No products are below their alert level.',
    productMix: 'Product mix', byCategory: 'By category', categoriesEmpty: 'Categories will appear as products are added.',
    latestChanges: 'Latest changes', recentActivity: 'Recent activity', stockActivityEmpty: 'Your stock activity will appear here.',
    allProducts: 'All products', inventoryDescription: 'Search, review, and update everything on your shelves.', searchPlaceholder: 'Search products or SKU',
    all: 'All', lowStock: 'Low stock', activityTrail: 'Audit trail', activityDescription: 'Every addition, removal, and correction in one place.', today: 'Today',
    noActivity: 'No activity yet', noActivityDescription: 'Your stock additions, removals, and corrections will appear here.',
    product: 'Product', available: 'Available', status: 'Status', expiry: 'Expiry', inStock: 'In stock', outOfStock: 'Out of stock',
    lowStockStatus: 'Low stock', expired: 'Expired', todayExpiry: 'Today', inventorySetup: 'Inventory setup', productDetails: 'Product details',
    updateStock: 'Update stock', close: 'Close', productName: 'Product name', productNamePlaceholder: 'e.g. Butter croissant', category: 'Category',
    measuredIn: 'Measured in', openingQuantity: 'Opening quantity', lowStockAlert: 'Low-stock alert', expiryDate: 'Expiry date', sku: 'SKU or code',
    optional: 'Optional', skuPlaceholder: 'BRD-001', cancel: 'Cancel', saving: 'Saving…', saveChanges: 'Save changes', currentBalance: 'Current balance',
    stockAction: 'Stock action', stockIn: 'Stock in', stockOut: 'Stock out', setCount: 'Set count', newTotalQuantity: 'New total quantity', quantity: 'Quantity',
    balanceAfterUpdate: 'Balance after update', note: 'Note', notePlaceholder: 'Delivery, sale, waste…', updating: 'Updating…', updateStockButton: 'Update stock',
    shelvesReady: 'Your shelves are ready', emptyInventoryDescription: 'Add your first bakery product to start tracking stock, deliveries, and low-stock alerts.',
    addFirstProduct: 'Add first product', noProductsFound: 'No products found', noProductsDescription: 'Try a different search or category.',
    stockReceived: 'Stock received', stockRemoved: 'Stock removed', countCorrected: 'Count corrected', openingStock: 'Opening stock', minimum: 'minimum',
    allChangesSaved: 'All changes saved', freshnessFirst: 'Freshness first', freshnessDescription: 'Keep counts current for clearer baking decisions.',
    productAdded: '{name} added to inventory.', productUpdated: '{name} updated.', stockUpdated: '{name} stock updated.',
    units: { pieces: 'pieces', loaves: 'loaves', cakes: 'cakes', kg: 'kg', g: 'g', litres: 'litres', bottles: 'bottles', boxes: 'boxes', packs: 'packs' },
    categories: { Bread: 'Bread', Pastries: 'Pastries', Cakes: 'Cakes', Ingredients: 'Ingredients', Packaging: 'Packaging', Drinks: 'Drinks', Other: 'Other' },
  },
}

function interpolate(value, variables = {}) {
  return value.replace(/\{(\w+)\}/g, (_match, key) => variables[key] ?? '')
}

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => {
    const saved = window.localStorage.getItem('bakery-language')
    return supportedLanguages.includes(saved) ? saved : 'es'
  })
  useEffect(() => {
    window.localStorage.setItem('bakery-language', language)
    document.documentElement.lang = language
  }, [language])
  const value = useMemo(() => {
    const dictionary = dictionaries[language]
    const t = (key, variables) => interpolate(dictionary[key] ?? dictionaries.en[key] ?? key, variables)
    return {
      language, setLanguage, t,
      categoryLabel: (category) => dictionary.categories[category] ?? category,
      unitLabel: (unit) => dictionary.units[unit] ?? unit,
      formatDate: (value) => new Intl.DateTimeFormat(language === 'es' ? 'es-CL' : 'en-US', { month: 'short', day: 'numeric' }).format(value instanceof Date ? value : new Date(`${value}T00:00:00`)),
      formatTime: (value) => new Intl.DateTimeFormat(language === 'es' ? 'es-CL' : 'en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(value)),
    }
  }, [language])
  return createElement(LanguageContext.Provider, { value }, children)
}

export function useI18n() {
  const value = useContext(LanguageContext)
  if (!value) throw new Error('useI18n must be used inside LanguageProvider')
  return value
}
