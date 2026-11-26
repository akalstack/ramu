import { describe, expect, it } from 'vitest'
import { shortHostName } from '../src/hostLabel'

describe('shortHostName', () => {
  it('keeps the first label of a network name', () => {
    expect(shortHostName('ip-10-10-198-76.ap-southeast-1.compute.internal')).toBe('ip-10-10-198-76')
    expect(shortHostName('Ahmads-mini-m4.local')).toBe('Ahmads-mini-m4')
  })
  it('leaves a typed name or an address as it is', () => {
    expect(shortHostName('Mac mini')).toBe('Mac mini')
    expect(shortHostName('Build box v2.1 (office)')).toBe('Build box v2.1 (office)')
    expect(shortHostName('127.0.0.1')).toBe('127.0.0.1')
    expect(shortHostName('studio')).toBe('studio')
    expect(shortHostName('v1.2')).toBe('v1.2')
    expect(shortHostName('box.tailnet.ts.net')).toBe('box')
  })
})
