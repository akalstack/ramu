import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { toBlocks } from '../src/views/agent/lib/blocks'
import { PermissionRequestCard } from '../src/views/agent/components/PermissionRequestCard'
import type { AgentEvent } from '@ramu/shared/types'

vi.mock('../src/i18n', () => ({
  useLanguage: () => {},
  t: (text: string) => text,
  currentLanguage: () => 'en',
  formatLocale: () => 'en-US',
}))
vi.mock('@/components/desktop-button', () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<'button'> & { variant?: string; size?: string }) => createElement('button', props),
}))
vi.mock('../src/Menu', () => ({
  Dropdown: () => null,
}))
vi.mock('../src/ipc', () => ({
  invoke: vi.fn(),
}))

const permissionEvent = (id: string, command = 'git status'): Extract<AgentEvent, { kind: 'permission-request' }> => ({
  kind: 'permission-request',
  requestId: id,
  toolName: 'Bash',
  title: command,
  detail: JSON.stringify({ CommandLine: command }),
})

describe('permission request visibility', () => {
  it('omits approved permission requests from chat blocks', () => {
    const events: AgentEvent[] = [
      permissionEvent('req-1', 'git status'),
      { kind: 'request-resolved', requestId: 'req-1', outcome: 'allowed' },
      { kind: 'tool-use', toolUseId: 't-1', name: 'Bash', summary: 'git status' },
      permissionEvent('req-2', 'git diff'),
      { kind: 'request-resolved', requestId: 'req-2', outcome: 'allowed-auto' },
      { kind: 'tool-use', toolUseId: 't-2', name: 'Bash', summary: 'git diff' },
      permissionEvent('req-3', 'npm install'),
      { kind: 'request-resolved', requestId: 'req-3', outcome: 'allowed-user' },
    ]

    const blocks = toBlocks(events)
    expect(blocks.some((b) => b.kind === 'event' && b.event.kind === 'permission-request')).toBe(false)
    expect(blocks.filter((b) => b.kind === 'tools')).toHaveLength(1)
  })

  it('preserves pending and denied permission requests in chat blocks', () => {
    const events: AgentEvent[] = [
      permissionEvent('req-pending', 'rm -rf dist'),
      permissionEvent('req-denied', 'drop table users'),
      { kind: 'request-resolved', requestId: 'req-denied', outcome: 'denied' },
    ]

    const blocks = toBlocks(events)
    const permissions = blocks.flatMap((b) => (b.kind === 'event' && b.event.kind === 'permission-request' ? [b.event] : []))
    expect(permissions.map((p) => p.requestId)).toEqual(['req-pending', 'req-denied'])
  })

  it('renders nothing from PermissionRequestCard when approved, but shows prompt or outcome when pending/denied', () => {
    const event = permissionEvent('req-1', 'git status')

    const approvedMarkup = renderToStaticMarkup(
      createElement(PermissionRequestCard, {
        event,
        sessionId: 's-1',
        pending: false,
        outcome: 'allowed',
      }),
    )
    expect(approvedMarkup).toBe('')

    const pendingMarkup = renderToStaticMarkup(
      createElement(PermissionRequestCard, {
        event,
        sessionId: 's-1',
        pending: true,
        outcome: undefined,
      }),
    )
    expect(pendingMarkup).toContain('Allow once')
    expect(pendingMarkup).toContain('Deny')

    const deniedMarkup = renderToStaticMarkup(
      createElement(PermissionRequestCard, {
        event,
        sessionId: 's-1',
        pending: false,
        outcome: 'denied',
      }),
    )
    expect(deniedMarkup).toContain('Denied')
  })
})
