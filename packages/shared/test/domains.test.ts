import { expect, it } from 'vitest'
import { apexOf } from '../src/domains'

it('finds the registered domain of a host name, including shared suffixes', () => {
  expect(apexOf('www.example.com')).toBe('example.com')
  expect(apexOf('example.com')).toBe('example.com')
  expect(apexOf('toko.kopi.co.id')).toBe('kopi.co.id')
})
