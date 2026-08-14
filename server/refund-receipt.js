const minimumContentLength = 100
const maximumContentLength = 4096
const lineWidth = 32

function printerText(value, maximumLength = 160) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximumLength)
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

function smallLines(value) {
  return wrapWords(value).map((line) => `{s}${line}{/s}{br}`).join('')
}

function money(value) {
  return `$${Math.round(Number(value || 0)).toLocaleString('es-CL')}`
}

function receiptTimestamp(value) {
  const date = new Date(value || Date.now())
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Santiago',
  }).format(date).replace(',', '')
}

export function renderPointRefundCopy(sale, refund) {
  const saleReference = printerText(sale.shortId || sale.id, 40).toUpperCase()
  const operationId = printerText(sale.mpOperationId || sale.mpPaymentId || '', 80)
  const refundId = printerText(refund.mpRefundId || refund.id, 80)
  const card = [
    printerText(sale.mpCardBrand, 24).toUpperCase(),
    sale.mpCardLastFour ? `**** ${printerText(sale.mpCardLastFour, 4)}` : '',
  ].filter(Boolean).join(' ')

  const content = [
    '{center}',
    '{w}{b}COPIA DE DEVOLUCION{/b}{/w}{br}',
    '{b}BAKERY POS{/b}{br}',
    '{s}NO TRIBUTARIO{/s}{br}',
    '{/center}',
    '--------------------------------{br}',
    '{left}',
    smallLines(`Venta: #${saleReference}`),
    smallLines(`Fecha: ${receiptTimestamp(refund.processedAt || refund.updatedAt || refund.createdAt)}`),
    `{w}{b}DEVUELTO ${money(refund.amount)}{/b}{/w}{br}`,
    operationId ? smallLines(`Operacion MP: ${operationId}`) : '',
    refundId ? smallLines(`Devolucion MP: ${refundId}`) : '',
    card ? smallLines(`Medio original: ${card}`) : '',
    '--------------------------------{br}',
    smallLines('Mercado Pago proceso la devolucion al medio de pago original.'),
    '{br}',
    smallLines('Esta copia no reemplaza el voucher oficial de Mercado Pago ni una nota de credito o DTE.'),
    '{/left}',
  ].join('')

  if (content.length < minimumContentLength || content.length > maximumContentLength) {
    throw Object.assign(new Error(`Refund copy content must contain between ${minimumContentLength} and ${maximumContentLength} characters.`), { status: 500 })
  }
  return content
}
