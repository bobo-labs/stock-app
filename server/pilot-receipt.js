import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const minimumContentLength = 100
const maximumContentLength = 4096
const lineWidth = 32
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultLogoPath = path.join(moduleDirectory, '..', 'assets', 'atelier-del-puerto-receipt.png')

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

function receiptState(sale) {
  const total = Math.max(Number(sale.total || 0), 0)
  const refundSum = Array.isArray(sale.refunds)
    ? sale.refunds
      .filter((refund) => refund.status === 'processed')
      .reduce((sum, refund) => sum + Number(refund.amount || 0), 0)
    : 0
  let refundedTotal = Math.max(Number(sale.refundedTotal ?? refundSum), 0)
  if (sale.status === 'refunded' && refundedTotal === 0) refundedTotal = total
  refundedTotal = Math.min(refundedTotal, total)
  const remainingTotal = Math.max(total - refundedTotal, 0)
  const fullRefund = total > 0 && (sale.status === 'refunded' || refundedTotal >= total)
  const partialRefund = !fullRefund && refundedTotal > 0

  return {
    refundedTotal,
    remainingTotal,
    fullRefund,
    partialRefund,
    label: fullRefund ? 'VENTA REEMBOLSADA' : partialRefund ? 'REEMBOLSO PARCIAL' : 'VENTA PAGADA',
  }
}

export function pilotReceiptConfiguration() {
  return {
    enabled: process.env.POINT_PILOT_RECEIPT_ENABLED === 'true',
    logoEnabled: process.env.POINT_PILOT_LOGO_ENABLED !== 'false',
    logoPath: environment('POINT_PILOT_RECEIPT_LOGO_PATH', defaultLogoPath),
    businessName: environment('POINT_PILOT_BUSINESS_NAME', 'Atelier del Puerto'),
    businessRut: environment('POINT_PILOT_BUSINESS_RUT', 'RUT DEMOSTRACION'),
    address: environment('POINT_PILOT_BUSINESS_ADDRESS', '1 Pte 1065, Vina del Mar'),
    city: environment('POINT_PILOT_BUSINESS_CITY', 'Valparaiso, Chile'),
  }
}

export async function loadPilotReceiptLogo() {
  const config = pilotReceiptConfiguration()
  if (!config.logoEnabled) return null
  try {
    const image = await fs.readFile(config.logoPath)
    const isPng = image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    if (!isPng || image.length > 1024 * 1024) throw new Error('The Point logo must be a PNG no larger than 1 MB.')
    return image.toString('base64')
  } catch (error) {
    console.error('Point pilot receipt logo could not be loaded:', error)
    return null
  }
}

export async function renderPilotReceipt(sale, { logoIncluded = false } = {}) {
  const config = pilotReceiptConfiguration()
  const state = receiptState(sale)
  const paidAt = sale.paidAt || sale.updatedAt || Date.now()
  const operation = sale.mpOperationId ? smallLines(`Operacion MP: ${sale.mpOperationId}`) : ''
  const card = [sale.mpCardBrand, sale.mpCardLastFour ? `**** ${sale.mpCardLastFour}` : '']
    .filter(Boolean)
    .join(' ')
  const cardDetail = card ? smallLines(`Tarjeta: ${card}`) : ''
  const authorization = sale.mpAuthorizationCode
    ? smallLines(`Autorizacion: ${sale.mpAuthorizationCode}`)
    : ''
  const fallbackBusinessName = logoIncluded
    ? ''
    : `{b}${printerText(config.businessName, 60).toUpperCase()}{/b}{br}`
  const header = [
    '{center}',
    fallbackBusinessName,
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
    smallLines(`Estado: ${state.label}`),
    operation,
    '--------------------------------{br}',
    '{b}DETALLE DE LA COMPRA{/b}{br}{br}',
  ].join('')
  const paymentDescription = sale.paymentMethod === 'card'
    ? 'Pago con tarjeta mediante Mercado Pago Point'
    : 'Pago en efectivo'
  const totals = state.fullRefund || state.partialRefund
    ? [
        `{b}TOTAL ORIGINAL ${money(sale.total)}{/b}{br}`,
        `{b}REEMBOLSADO ${money(state.refundedTotal)}{/b}{br}`,
        `{w}{b}SALDO ${money(state.remainingTotal)}{/b}{/w}{br}`,
      ].join('')
    : `{w}{b}TOTAL ${money(sale.total)}{/b}{/w}{br}`
  const closingMessage = state.fullRefund
    ? 'COMPROBANTE ACTUALIZADO'
    : state.partialRefund
      ? 'COMPROBANTE ACTUALIZADO'
      : 'GRACIAS POR SU COMPRA'
  const footer = [
    '--------------------------------{br}',
    totals,
    smallLines(paymentDescription),
    cardDetail,
    authorization,
    '{/left}{br}',
    `{center}{w}{b}${state.label}{/b}{/w}{br}`,
    `{b}${closingMessage}{/b}{br}`,
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
