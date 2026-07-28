import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react'
import { parseCalendarDate } from './dates.js'

const LanguageContext = createContext(null)
const supportedLanguages = ['es', 'en']

const dictionaries = {
  es: {
    brandSubtitle: 'Panel de mostrador', language: 'Idioma', openMenu: 'Abrir menú', preparing: 'Preparando tu panel…',
    overview: 'Resumen', sales: 'Ventas', inventory: 'Inventario', activity: 'Actividad',
    welcomeBack: 'Bienvenido de nuevo', loginDescription: 'Ingresa el código del personal para abrir el mostrador.', staffPin: 'Código de acceso',
    signingIn: 'Ingresando…', signIn: 'Ingresar', signOut: 'Cerrar sesión',
    somethingWentWrong: 'Algo salió mal', unexpectedErrorDescription: 'No pudimos mostrar esta sección. Recarga la aplicación para continuar.', reloadApp: 'Recargar aplicación',
    liveInventory: 'Inventario en vivo', greetingMorning: 'Buenos días.', greetingAfternoon: 'Buenas tardes.', greetingEvening: 'Buenas noches.',
    welcomeMessage: 'Esto es lo que está pasando en tu panadería hoy.', addProduct: 'Agregar producto', add: 'Agregar', newSale: 'Nueva venta',
    salesToday: 'Ventas de hoy', transactionsToday: '{count} transacciones',
    inventorySummary: 'Resumen del inventario', products: 'Productos', acrossCategories: 'En {count} categorías',
    unitsOnHand: 'Unidades disponibles', currentRecordedTotal: 'Total registrado', needAttention: 'Requieren atención',
    atOrBelowMinimum: 'En o bajo el mínimo', everythingHealthy: 'Todo se ve bien', expiringSoon: 'Próximos a vencer',
    next3Days: 'En los próximos 3 días', inventoryHealth: 'Salud del inventario', stockRequiringAttention: 'Stock que requiere atención',
    viewAll: 'Ver todo', everythingStocked: 'Todo está abastecido', noBelowAlert: 'No hay productos bajo su nivel de alerta.',
    productMix: 'Mezcla de productos', byCategory: 'Por categoría', categoriesEmpty: 'Las categorías aparecerán al agregar productos.',
    latestChanges: 'Últimos cambios', recentActivity: 'Actividad reciente', stockActivityEmpty: 'La actividad del stock aparecerá aquí.',
    allProducts: 'Todos los productos', inventoryDescription: 'Busca, revisa y actualiza todo lo que tienes en tus estantes.',
    searchPlaceholder: 'Buscar productos o SKU', all: 'Todos', lowStock: 'Stock bajo', forSale: 'En venta', notForSale: 'No se vende',
    activityTrail: 'Historial de cambios', activityDescription: 'Cada entrada, salida y corrección en un solo lugar.', today: 'Hoy',
    noActivity: 'Aún no hay actividad', noActivityDescription: 'Tus entradas, salidas y correcciones aparecerán aquí.',
    product: 'Producto', available: 'Disponible', status: 'Estado', expiry: 'Vencimiento',
    inStock: 'En stock', outOfStock: 'Agotado', lowStockStatus: 'Stock bajo', expired: 'Vencido', todayExpiry: 'Hoy',
    inventorySetup: 'Configuración del inventario', productDetails: 'Detalles del producto', updateStock: 'Actualizar stock', close: 'Cerrar',
    productName: 'Nombre del producto', productNamePlaceholder: 'ej. Croissant de mantequilla', category: 'Categoría', measuredIn: 'Medido en',
    openingQuantity: 'Cantidad inicial', lowStockAlert: 'Alerta de stock bajo', expiryDate: 'Fecha de vencimiento', sku: 'SKU o código',
    optional: 'Opcional', skuPlaceholder: 'PAN-001', cancel: 'Cancelar', saving: 'Guardando…', saveChanges: 'Guardar cambios',
    sellAtCounter: 'Vender en el mostrador', sellAtCounterDescription: 'Aparecerá en el catálogo de ventas.', salePrice: 'Precio de venta (CLP)',
    currentBalance: 'Saldo actual', stockAction: 'Acción de stock', stockIn: 'Entrada', stockOut: 'Salida', setCount: 'Fijar cantidad',
    newTotalQuantity: 'Nueva cantidad total', quantity: 'Cantidad', balanceAfterUpdate: 'Saldo después de actualizar', note: 'Nota',
    notePlaceholder: 'Entrega, venta, merma…', updating: 'Actualizando…', updateStockButton: 'Actualizar stock',
    shelvesReady: 'Tus estantes están listos', emptyInventoryDescription: 'Agrega tu primer producto para comenzar a controlar stock, entregas y alertas.',
    addFirstProduct: 'Agregar primer producto', noProductsFound: 'No encontramos productos', noProductsDescription: 'Prueba con otra búsqueda o categoría.',
    stockReceived: 'Stock recibido', stockRemoved: 'Stock retirado', countCorrected: 'Cantidad corregida',
    saleMovement: 'Venta #{id}', cardStockReserved: 'Stock reservado para venta #{id}', cardStockRestored: 'Stock restaurado de venta #{id}',
    openingStock: 'Stock inicial', minimum: 'mínimo', allChangesSaved: 'Todos los cambios guardados', freshnessFirst: 'Primero la frescura',
    freshnessDescription: 'Mantén las cantidades al día para tomar mejores decisiones de producción.',
    productAdded: '{name} se agregó al inventario.', productUpdated: '{name} se actualizó.', stockUpdated: 'El stock de {name} se actualizó.',
    deleteProduct: 'Eliminar producto', deleteProductQuestion: '¿Eliminar este producto?',
    deleteProductDescription: '“{name}” desaparecerá del inventario y del catálogo. Las ventas y el historial existentes se conservarán.',
    deleteProductStockWarning: 'También se eliminarán {count} {unit} del stock actual.', keepProduct: 'Conservar producto',
    deletePermanently: 'Eliminar definitivamente', deleting: 'Eliminando…', productDeleted: '{name} se eliminó del inventario.',
    counterMode: 'Modo mostrador', salesCounter: 'Punto de venta', salesDescription: 'Toca los productos, arma el pedido y cobra en segundos.',
    pointDemoMode: 'Point · modo demo', pointOffline: 'Point sin configurar', pointReady: 'Point {id} está listo en modo PDV.', pointNeedsPdv: 'La terminal no está lista. Revisa que esté asociada y en modo PDV.',
    searchProducts: 'Buscar productos para vender', configureProductsForSale: 'Configura tus productos para vender',
    configureProductsDescription: 'Edita pan, pasteles o bebidas, activa “Vender en el mostrador” y agrega su precio.', availableLower: 'disponibles',
    currentOrder: 'Pedido actual', cart: 'Carrito', clear: 'Vaciar', emptyCart: 'El carrito está vacío', tapProducts: 'Toca un producto para agregarlo al pedido.',
    productsCount: '{count} productos', total: 'Total', charge: 'Cobrar', removeOne: 'Quitar uno', addOne: 'Agregar uno', removeFromCart: 'Quitar del carrito',
    todayAndRecent: 'Hoy y recientes', recentSales: 'Ventas recientes', noSalesYet: 'Las ventas aparecerán aquí.', item: 'producto', items: 'productos',
    salePaid: 'Pagada', salePending: 'Pendiente', saleFailed: 'Fallida', saleCancelled: 'Cancelada', saleExpired: 'Vencida', saleRefunded: 'Reembolsada',
    checkout: 'Cobro', choosePaymentMethod: '¿Cómo pagará?', cardPayment: 'Pago con tarjeta', totalToPay: 'Total a pagar',
    cash: 'Efectivo', cashDescription: 'Registra el pago al instante.', card: 'Tarjeta', pointSmart2Description: 'Enviar el cobro a Point Smart 2.',
    pointNotConfigured: 'Configura Point Smart 2 para habilitarlo.', pointSetupHint: 'Agrega las variables de Mercado Pago en Railway para activar pagos con tarjeta.',
    sendingToPoint: 'Enviando el cobro a Point', followPointInstructions: 'Sigue las instrucciones de Point',
    connectingPointDescription: 'Estamos preparando la terminal. No cierres esta ventana.', customerUseTerminal: 'El cliente puede acercar, insertar o deslizar su tarjeta.',
    sale: 'Venta', checkTerminal: 'Revisa la pantalla de la terminal para continuar.', cancelPayment: 'Cancelar cobro',
    connectionUncertain: 'No pudimos confirmar la conexión', retryConnection: 'Reintentar conexión', paymentCouldNotStart: 'No se pudo iniciar el cobro',
    reservedSaleRecovery: 'La venta sigue reservada. Reintenta la conexión para recuperar o confirmar el cobro.',
    stockRestored: 'El cobro no se completó y el stock reservado fue restaurado.', returnToCart: 'Volver al carrito',
    paymentApproved: 'Pago aprobado', cardSaleCompleted: 'La venta con tarjeta quedó registrada y conciliada.', cashSaleCompleted: 'La venta en efectivo quedó registrada.',
    units: { pieces: 'unidades', loaves: 'panes', cakes: 'tortas', kg: 'kg', g: 'g', litres: 'litros', bottles: 'botellas', boxes: 'cajas', packs: 'paquetes' },
    categories: { Bread: 'Pan', Pastries: 'Pastelería', Cakes: 'Tortas', Ingredients: 'Ingredientes', Packaging: 'Embalaje', Drinks: 'Bebidas', Other: 'Otro' },
  },
  en: {
    brandSubtitle: 'Counter dashboard', language: 'Language', openMenu: 'Open menu', preparing: 'Preparing your dashboard…', overview: 'Overview', sales: 'Sales', inventory: 'Inventory', activity: 'Activity',
    welcomeBack: 'Welcome back', loginDescription: 'Enter the staff access code to open the counter.', staffPin: 'Access code',
    signingIn: 'Signing in…', signIn: 'Sign in', signOut: 'Sign out',
    somethingWentWrong: 'Something went wrong', unexpectedErrorDescription: 'We could not display this section. Reload the application to continue.', reloadApp: 'Reload application',
    liveInventory: 'Live inventory', greetingMorning: 'Good morning.', greetingAfternoon: 'Good afternoon.', greetingEvening: 'Good evening.',
    welcomeMessage: 'Here’s what’s happening across your bakery today.', addProduct: 'Add product', add: 'Add', newSale: 'New sale',
    salesToday: 'Sales today', transactionsToday: '{count} transactions',
    inventorySummary: 'Inventory summary', products: 'Products', acrossCategories: 'Across {count} categories',
    unitsOnHand: 'Units on hand', currentRecordedTotal: 'Current recorded total', needAttention: 'Need attention',
    atOrBelowMinimum: 'At or below minimum', everythingHealthy: 'Everything looks healthy', expiringSoon: 'Expiring soon',
    next3Days: 'Within the next 3 days', inventoryHealth: 'Inventory health', stockRequiringAttention: 'Stock requiring attention',
    viewAll: 'View all', everythingStocked: 'Everything looks stocked', noBelowAlert: 'No products are below their alert level.',
    productMix: 'Product mix', byCategory: 'By category', categoriesEmpty: 'Categories will appear as products are added.',
    latestChanges: 'Latest changes', recentActivity: 'Recent activity', stockActivityEmpty: 'Your stock activity will appear here.',
    allProducts: 'All products', inventoryDescription: 'Search, review, and update everything on your shelves.', searchPlaceholder: 'Search products or SKU',
    all: 'All', lowStock: 'Low stock', forSale: 'For sale', notForSale: 'Not for sale', activityTrail: 'Audit trail', activityDescription: 'Every addition, removal, and correction in one place.', today: 'Today',
    noActivity: 'No activity yet', noActivityDescription: 'Your stock additions, removals, and corrections will appear here.',
    product: 'Product', available: 'Available', status: 'Status', expiry: 'Expiry', inStock: 'In stock', outOfStock: 'Out of stock',
    lowStockStatus: 'Low stock', expired: 'Expired', todayExpiry: 'Today', inventorySetup: 'Inventory setup', productDetails: 'Product details',
    updateStock: 'Update stock', close: 'Close', productName: 'Product name', productNamePlaceholder: 'e.g. Butter croissant', category: 'Category',
    measuredIn: 'Measured in', openingQuantity: 'Opening quantity', lowStockAlert: 'Low-stock alert', expiryDate: 'Expiry date', sku: 'SKU or code',
    optional: 'Optional', skuPlaceholder: 'BRD-001', cancel: 'Cancel', saving: 'Saving…', saveChanges: 'Save changes',
    sellAtCounter: 'Sell at the counter', sellAtCounterDescription: 'Shows in the sales catalog.', salePrice: 'Sale price (CLP)', currentBalance: 'Current balance',
    stockAction: 'Stock action', stockIn: 'Stock in', stockOut: 'Stock out', setCount: 'Set count', newTotalQuantity: 'New total quantity', quantity: 'Quantity',
    balanceAfterUpdate: 'Balance after update', note: 'Note', notePlaceholder: 'Delivery, sale, waste…', updating: 'Updating…', updateStockButton: 'Update stock',
    shelvesReady: 'Your shelves are ready', emptyInventoryDescription: 'Add your first bakery product to start tracking stock, deliveries, and low-stock alerts.',
    addFirstProduct: 'Add first product', noProductsFound: 'No products found', noProductsDescription: 'Try a different search or category.',
    stockReceived: 'Stock received', stockRemoved: 'Stock removed', countCorrected: 'Count corrected', openingStock: 'Opening stock', minimum: 'minimum',
    saleMovement: 'Sale #{id}', cardStockReserved: 'Stock reserved for sale #{id}', cardStockRestored: 'Stock restored from sale #{id}',
    allChangesSaved: 'All changes saved', freshnessFirst: 'Freshness first', freshnessDescription: 'Keep counts current for clearer baking decisions.',
    productAdded: '{name} added to inventory.', productUpdated: '{name} updated.', stockUpdated: '{name} stock updated.',
    deleteProduct: 'Delete product', deleteProductQuestion: 'Delete this product?',
    deleteProductDescription: '“{name}” will disappear from inventory and the catalog. Existing sales and activity history will be preserved.',
    deleteProductStockWarning: 'This will also remove {count} {unit} from current stock.', keepProduct: 'Keep product',
    deletePermanently: 'Delete permanently', deleting: 'Deleting…', productDeleted: '{name} was removed from inventory.',
    counterMode: 'Counter mode', salesCounter: 'Point of sale', salesDescription: 'Tap products, build the order, and charge in seconds.',
    pointDemoMode: 'Point · demo mode', pointOffline: 'Point not configured', pointReady: 'Point {id} is ready in PDV mode.', pointNeedsPdv: 'The terminal is not ready. Check that it is paired and in PDV mode.',
    searchProducts: 'Search products to sell', configureProductsForSale: 'Configure products for sale',
    configureProductsDescription: 'Edit bread, pastries, or drinks, enable “Sell at the counter,” and add a price.', availableLower: 'available',
    currentOrder: 'Current order', cart: 'Cart', clear: 'Clear', emptyCart: 'Your cart is empty', tapProducts: 'Tap a product to add it to the order.',
    productsCount: '{count} products', total: 'Total', charge: 'Charge', removeOne: 'Remove one', addOne: 'Add one', removeFromCart: 'Remove from cart',
    todayAndRecent: 'Today and recent', recentSales: 'Recent sales', noSalesYet: 'Sales will appear here.', item: 'item', items: 'items',
    salePaid: 'Paid', salePending: 'Pending', saleFailed: 'Failed', saleCancelled: 'Cancelled', saleExpired: 'Expired', saleRefunded: 'Refunded',
    checkout: 'Checkout', choosePaymentMethod: 'How will they pay?', cardPayment: 'Card payment', totalToPay: 'Total to pay',
    cash: 'Cash', cashDescription: 'Record the payment immediately.', card: 'Card', pointSmart2Description: 'Send the charge to Point Smart 2.',
    pointNotConfigured: 'Configure Point Smart 2 to enable it.', pointSetupHint: 'Add the Mercado Pago variables in Railway to activate card payments.',
    sendingToPoint: 'Sending the charge to Point', followPointInstructions: 'Follow the Point instructions',
    connectingPointDescription: 'We are preparing the terminal. Keep this window open.', customerUseTerminal: 'The customer can tap, insert, or swipe their card.',
    sale: 'Sale', checkTerminal: 'Check the terminal screen to continue.', cancelPayment: 'Cancel payment',
    connectionUncertain: 'We could not confirm the connection', retryConnection: 'Retry connection', paymentCouldNotStart: 'The payment could not start',
    reservedSaleRecovery: 'The sale is still reserved. Retry the connection to recover or confirm the charge.',
    stockRestored: 'The charge did not complete and the reserved stock was restored.', returnToCart: 'Return to cart',
    paymentApproved: 'Payment approved', cardSaleCompleted: 'The card sale is recorded and reconciled.', cashSaleCompleted: 'The cash sale is recorded.',
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
      formatDate: (value) => {
        const date = parseCalendarDate(value)
        return date ? new Intl.DateTimeFormat(language === 'es' ? 'es-CL' : 'en-US', { month: 'short', day: 'numeric' }).format(date) : '—'
      },
      formatTime: (value) => new Intl.DateTimeFormat(language === 'es' ? 'es-CL' : 'en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(value)),
      formatCurrency: (value) => new Intl.NumberFormat(language === 'es' ? 'es-CL' : 'en-US', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(value) || 0),
    }
  }, [language])
  return createElement(LanguageContext.Provider, { value }, children)
}

export function useI18n() {
  const value = useContext(LanguageContext)
  if (!value) throw new Error('useI18n must be used inside LanguageProvider')
  return value
}
