const minimumContentLength = 100
const maximumContentLength = 4096
const lineWidth = 32

function environment(name, fallback = '') {
  return String(process.env[name] || fallback).trim()
}

function printerText(value, maximumLength = 160) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximumLength)
}

function money(value) {
  return `$${Math.round(Number(value || 0)).toLocaleString('es-CL')}`
}

function quantity(value) {
  return Number(value).toLocaleString('es-CL', { maximumFractionDigits: 2 })
}

function splitLongWord(word, maximumLength) {
  const parts = []
  for (let index = 0; index < word.length; index += maximumLength) {
    parts.push(word.slice(index, index + maximumLength))
  }
  return parts
}

function wrapWords(value, maximumLength = lineWidth) {
  const words = printerText(value)
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => word.length > maximumLength ? splitLongWord(word, maximumLength) : [word])
  if (!words.length) return ['']

  const lines = []
  let current = ''
  for (const word of words) {
    if (!current) current = word
    else if (`${current} ${word}`.length <= maximumLength) current += ` ${word}`
    else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

function smallLines(value, maximumLength = lineWidth) {
  return wrapWords(value, maximumLength).map((line) => `{s}${line}{/s}{br}`).join('')
}

function saleItemContent(item) {
  const name = wrapWords(printerText(item.name, 240).toUpperCase())
    .map((line) => `{b}${line}{/b}{br}`)
    .join('')
  const detail = `${quantity(item.quantity)} x ${money(item.unitPrice)}  =  ${money(item.lineTotal)}`
  return `${name}${smallLines(detail)}{br}`
}

function receiptTimestamp(value) {
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Santiago',
  }).format(new Date(value)).replace(',', '')
}

export function pilotReceiptConfiguration() {
  return {
    enabled: process.env.POINT_PILOT_RECEIPT_ENABLED === 'true',
    businessName: environment('POINT_PILOT_BUSINESS_NAME', 'Atelier del Puerto'),
    businessRut: environment('POINT_PILOT_BUSINESS_RUT', 'RUT DEMOSTRACION'),
    address: environment('POINT_PILOT_BUSINESS_ADDRESS', '1 Pte 1065, Vina del Mar'),
    city: environment('POINT_PILOT_BUSINESS_CITY', 'Valparaiso, Chile'),
  }
}

export async function renderPilotReceipt(sale) {
  const config = pilotReceiptConfiguration()
  const paidAt = sale.paidAt || sale.updatedAt || Date.now()
  const operation = sale.mpOperationId ? smallLines(`Operacion MP: ${sale.mpOperationId}`) : ''
  const card = [sale.mpCardBrand, sale.mpCardLastFour ? `**** ${sale.mpCardLastFour}` : '']
    .filter(Boolean)
    .join(' ')
  const cardDetail = card ? smallLines(`Tarjeta: ${card}`) : ''
  const authorization = sale.mpAuthorizationCode
    ? smallLines(`Autorizacion: ${sale.mpAuthorizationCode}`)
    : ''
  const header = [
    '{center}',
    `{w}{b}${printerText(config.businessName, 60).toUpperCase()}{/b}{/w}{br}`,
    smallLines(config.businessRut),
    smallLines(config.address),
    smallLines(config.city),
    '{br}{b}COMPROBANTE PILOTO{/b}{br}',
    '{b}NO TRIBUTARIO{/b}{br}',
    '{/center}',
    '{br}--------------------------------{br}',
    '{left}',
    smallLines(`Venta: #${printerText(sale.shortId, 32)}`),
    smallLines(`Fecha: ${receiptTimestamp(paidAt)}`),
    operation,
    '--------------------------------{br}',
    '{b}DETALLE DE LA COMPRA{/b}{br}{br}',
  ].join('')
  const paymentDescription = sale.paymentMethod === 'card'
    ? 'Pago con tarjeta mediante Mercado Pago Point'
    : 'Pago en efectivo'
  const footer = [
    '--------------------------------{br}',
    `{w}{b}TOTAL ${money(sale.total)}{/b}{/w}{br}`,
    smallLines(paymentDescription),
    cardDetail,
    authorization,
    '{/left}{br}',
    '{center}{b}GRACIAS POR SU COMPRA{/b}{br}',
    '{s}Documento demostrativo.{/s}{br}',
    '{s}No es boleta ni DTE.{/s}{br}{/center}',
  ].join('')

  const items = Array.isArray(sale.items) ? sale.items : []
  let details = ''
  let includedItems = 0
  const reservedOmissionLength = 96
  for (const item of items) {
    const itemContent = saleItemContent(item)
    if (header.length + details.length + itemContent.length + footer.length + reservedOmissionLength > maximumContentLength) break
    details += itemContent
    includedItems += 1
  }

  const omittedItems = items.length - includedItems
  if (omittedItems > 0) {
    details += `{s}... ${omittedItems} producto${omittedItems === 1 ? '' : 's'} adicional${omittedItems === 1 ? '' : 'es'}{/s}{br}{br}`
  }

  const content = `${header}${details}${footer}`
  if (content.length < minimumContentLength || content.length > maximumContentLength) {
    throw new Error(`Pilot receipt content must contain between ${minimumContentLength} and ${maximumContentLength} characters.`)
  }
  return content
}
