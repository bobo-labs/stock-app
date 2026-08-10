import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultLogoPath = path.join(moduleDirectory, '..', 'assets', 'atelier-del-puerto-receipt.png')
const receiptWidth = 576

function environment(name, fallback = '') {
  return String(process.env[name] || fallback).trim()
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function money(value) {
  return `$${Math.round(Number(value || 0)).toLocaleString('es-CL')}`
}

function quantity(value) {
  return Number(value).toLocaleString('es-CL', { maximumFractionDigits: 2 })
}

function wrapWords(value, maxCharacters = 35) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ['']
  const lines = []
  let current = ''
  for (const word of words) {
    if (!current) current = word
    else if (`${current} ${word}`.length <= maxCharacters) current += ` ${word}`
    else { lines.push(current); current = word }
  }
  if (current) lines.push(current)
  return lines
}

function text(x, y, value, options = {}) {
  const { anchor = 'start', size = 23, weight = 500, family = 'Arial, sans-serif' } = options
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="#000">${escapeXml(value)}</text>`
}

async function receiptLogo() {
  const configuredPath = environment('POINT_PILOT_RECEIPT_LOGO_PATH')
  const logoPath = configuredPath || defaultLogoPath
  try {
    const logo = await fs.readFile(logoPath)
    return `data:image/png;base64,${logo.toString('base64')}`
  } catch {
    return null
  }
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
  const logo = await receiptLogo()
  const paidAt = new Date(sale.paidAt || sale.updatedAt || Date.now())
  const timestamp = new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Santiago',
  }).format(paidAt)
  const detailRows = sale.items.flatMap((line) => {
    const names = wrapWords(line.name.toUpperCase(), 31)
    return names.map((name, index) => ({
      name,
      meta: index === names.length - 1 ? `${quantity(line.quantity)} x ${money(line.unitPrice)}` : '',
      amount: index === names.length - 1 ? money(line.lineTotal) : '',
    }))
  })
  const baseHeight = 590
  const rowHeight = 31
  const height = Math.max(820, baseHeight + (detailRows.length * rowHeight))
  let y = 48
  const elements = []

  elements.push('<rect width="100%" height="100%" fill="#fff"/>')
  if (logo) {
    elements.push(`<image href="${logo}" x="188" y="24" width="200" height="200" preserveAspectRatio="xMidYMid meet"/>`)
    y = 246
  } else {
    elements.push(text(receiptWidth / 2, 66, config.businessName.toUpperCase(), { anchor: 'middle', size: 31, weight: 800 }))
    y = 96
  }
  elements.push(text(receiptWidth / 2, y, config.businessName.toUpperCase(), { anchor: 'middle', size: 29, weight: 800 }))
  y += 34
  elements.push(text(receiptWidth / 2, y, config.businessRut, { anchor: 'middle', size: 20, weight: 600 }))
  y += 28
  elements.push(text(receiptWidth / 2, y, config.address, { anchor: 'middle', size: 19 }))
  y += 25
  elements.push(text(receiptWidth / 2, y, config.city, { anchor: 'middle', size: 19 }))
  y += 33
  elements.push('<line x1="28" x2="548" y1="' + y + '" y2="' + y + '" stroke="#000" stroke-width="2"/>')
  y += 34
  elements.push(text(28, y, 'COPIA NEGOCIO - COMPROBANTE PILOTO', { size: 21, weight: 800 }))
  y += 28
  elements.push(text(28, y, 'NO TRIBUTARIO', { size: 21, weight: 800 }))
  y += 28
  elements.push(text(28, y, `Venta #${sale.shortId}`))
  y += 28
  elements.push(text(28, y, timestamp))
  if (sale.mpOperationId) {
    y += 28
    elements.push(text(28, y, `Operacion MP: ${sale.mpOperationId}`, { size: 20 }))
  }
  y += 34
  elements.push('<line x1="28" x2="548" y1="' + y + '" y2="' + y + '" stroke="#000" stroke-width="2"/>')
  y += 34
  elements.push(text(28, y, 'DETALLE DE LA COMPRA', { size: 22, weight: 800 }))
  y += 32
  for (const row of detailRows) {
    elements.push(text(28, y, row.name, { size: 19, weight: 650 }))
    if (row.meta) elements.push(text(42, y + 24, row.meta, { size: 18 }))
    if (row.amount) elements.push(text(548, y + 24, row.amount, { anchor: 'end', size: 19, weight: 700 }))
    y += rowHeight + (row.meta ? 22 : 0)
  }
  y += 10
  elements.push('<line x1="28" x2="548" y1="' + y + '" y2="' + y + '" stroke="#000" stroke-width="2"/>')
  y += 48
  elements.push(text(28, y, 'TOTAL', { size: 30, weight: 900 }))
  elements.push(text(548, y, money(sale.total), { anchor: 'end', size: 34, weight: 900 }))
  y += 38
  elements.push(text(28, y, sale.paymentMethod === 'card' ? 'Pago con tarjeta mediante Mercado Pago Point' : 'Pago en efectivo', { size: 19 }))
  if (sale.mpCardBrand || sale.mpCardLastFour) {
    y += 27
    const card = [sale.mpCardBrand, sale.mpCardLastFour ? `****${sale.mpCardLastFour}` : ''].filter(Boolean).join(' ')
    elements.push(text(28, y, `Tarjeta: ${card}`, { size: 19 }))
  }
  if (sale.mpAuthorizationCode) {
    y += 27
    elements.push(text(28, y, `Autorizacion: ${sale.mpAuthorizationCode}`, { size: 19 }))
  }
  y += 44
  elements.push(text(receiptWidth / 2, y, 'Gracias por su compra', { anchor: 'middle', size: 24, weight: 800 }))
  y += 37
  elements.push(text(receiptWidth / 2, y, 'Documento demostrativo. No es boleta ni DTE.', { anchor: 'middle', size: 18, weight: 700 }))

  const finalHeight = Math.max(height, y + 45)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${receiptWidth}" height="${finalHeight}" viewBox="0 0 ${receiptWidth} ${finalHeight}">${elements.join('')}</svg>`
  const output = await sharp(Buffer.from(svg))
    .flatten({ background: '#fff' })
    .greyscale()
    .threshold(205)
    .png({ compressionLevel: 9, palette: true, colours: 2 })
    .toBuffer()
  if (output.length > 1024 * 1024) throw new Error('Pilot receipt image exceeds Mercado Pago\'s 1 MB printing limit.')
  return output.toString('base64')
}
