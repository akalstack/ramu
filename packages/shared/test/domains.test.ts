import { describe, expect, it } from 'vitest'
import { apexOf, domainName, recordName } from '../src/domains'

describe('custom domain names', () => {
  it('accepts what a person pastes and refuses what is not a host name', () => {
    expect(domainName(' https://Shop.Example.com/ ')).toBe('shop.example.com')
    expect(domainName('example.com.')).toBe('example.com')
    expect(domainName('localhost')).toBeNull()
    expect(domainName('exa mple.com')).toBeNull()
    expect(domainName('-bad.example.com')).toBeNull()
    expect(domainName('1.2.3.4')).toBeNull()
  })

  it('names records relative to the registered domain, including shared suffixes', () => {
    expect(apexOf('www.example.com')).toBe('example.com')
    expect(apexOf('example.com')).toBe('example.com')
    expect(apexOf('toko.kopi.co.id')).toBe('kopi.co.id')
    expect(recordName('www.example.com', 'example.com')).toBe('www')
    expect(recordName('example.com', 'example.com')).toBe('@')
    expect(recordName('_vercel.example.com', 'example.com')).toBe('_vercel')
    expect(recordName('a.b.kopi.co.id', 'kopi.co.id')).toBe('a.b')
  })
})
