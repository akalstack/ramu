import { describe, expect, it } from 'vitest'
import { HOST_PUSH_CHANNELS, WINDOW_PUSH_CHANNELS, isHostPushChannel } from '@ramu/shared/pushChannels'

describe('push channels', () => {
  it('classifies every push channel once', () => {
    const host = new Set<string>(HOST_PUSH_CHANNELS)
    for (const channel of WINDOW_PUSH_CHANNELS) expect(host.has(channel)).toBe(false)
    for (const channel of ['summaries:changed', 'usage:changed', 'background:connection', 'settings:changed'])
      expect(isHostPushChannel(channel)).toBe(true)
    expect(isHostPushChannel('device-state:changed')).toBe(false)
  })
})
