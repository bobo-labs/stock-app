import assert from 'node:assert/strict'
import test from 'node:test'
import { createDailyReport } from './report.js'

test('daily report includes reconciled metrics and remains a lightweight standalone file', () => {
  const metrics = {
    summary: { revenue: 125000, transactions: 18, averageTicket: 6944, itemsSold: 42, pendingPoint: 1, failedPayments: 2, refundedTotal: 0 },
    paymentMethods: { cash: { revenue: 45000, transactions: 7 }, card: { revenue: 80000, transactions: 11 } },
    topProducts: [{ itemId: 'one', name: 'Croissant <especial>', quantity: 12, revenue: 21600, revenueShare: 17.3 }],
    hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, revenue: hour === 9 ? 42000 : 0, transactions: hour === 9 ? 6 : 0 })),
    cashClosure: {
      openingCash: 50000, cashAdjustments: -20000, countedCash: 75000, cashSales: 45000,
      cardSales: 80000, totalSales: 125000, expectedCash: 75000, difference: 0, note: 'Caja cuadrada.',
    },
  }
  const items = [{ name: 'Croissant <especial>', sku: 'PAS-1', category: 'Pastries', unit: 'pieces', quantity: 8, lowStockThreshold: 10 }]
  const report = createDailyReport({ metrics, items, businessDate: '2026-07-30', language: 'es', generatedAt: new Date('2026-07-30T18:00:00Z') })

  assert.match(report, /^<!doctype html>/)
  assert.match(report, /Reporte diario de la panadería/)
  assert.match(report, /\$125\.000/)
  assert.match(report, /Croissant &lt;especial&gt;/)
  assert.doesNotMatch(report, /Croissant <especial>/)
  assert.match(report, /Caja cuadrada\./)
  assert.ok(Buffer.byteLength(report) < 100_000)
})
