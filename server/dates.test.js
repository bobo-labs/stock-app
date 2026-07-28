import assert from 'node:assert/strict'
import test from 'node:test'
import { dateOnly, parseCalendarDate } from '../src/dates.js'

test('calendar dates accept PostgreSQL and ISO representations', () => {
  assert.equal(dateOnly('2026-08-01'), '2026-08-01')
  assert.equal(dateOnly('2026-08-01T00:00:00.000Z'), '2026-08-01')
  assert.equal(dateOnly(new Date(2026, 7, 1)), '2026-08-01')
  assert.equal(parseCalendarDate('not-a-date'), null)
})
