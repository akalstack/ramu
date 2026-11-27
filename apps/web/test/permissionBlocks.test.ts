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
vi.mock('../src/workspace/addProject', () => ({ pickHostFolder: vi.fn() }))
vi.mock('../src/workspace/HostProvider', () => ({
  useHost: () => ({ id: 'local', isLocal: true, status: 'connected', invoke: vi.fn() }),
}))

const permissionEvent = (id: string, command = 'git status'): Extract<AgentEvent, { kind: 'permission-request' }> => ({
  kind: 'permission-request',
  requestId: id,
  toolName: 'Bash',
  title: command,
  detail: JSON.stringify({ CommandLine: command }),
})

describe('permission request visibility', () => {
  it('keeps requests the person allowed as quiet lines and leaves out ones allowed on their own', () => {
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
    const kept = blocks.flatMap((b) =>
      b.kind === 'event' && b.event.kind === 'permission-request' ? [b.event.requestId] : [],
    )
    // req-2 was allowed by a saved rule: nobody decided it, so its tool row stands for it.
    expect(kept).toEqual(['req-1', 'req-3'])
  })

  it('preserves pending and denied permission requests in chat blocks', () => {
    const events: AgentEvent[] = [
      permissionEvent('req-pending', 'rm -rf dist'),
      permissionEvent('req-denied', 'drop table users'),
      { kind: 'request-resolved', requestId: 'req-denied', outcome: 'denied' },
    ]

    const blocks = toBlocks(events)
    const permissions = blocks.flatMap((b) =>
      b.kind === 'event' && b.event.kind === 'permission-request' ? [b.event] : [],
    )
    expect(permissions.map((p) => p.requestId)).toEqual(['req-pending', 'req-denied'])
  })

  it('an approved request is one quiet Allowed line, as on the phone, and a pending or denied one shows its prompt or outcome', () => {
    const event = permissionEvent('req-1', 'git status')

    const approvedMarkup = renderToStaticMarkup(
      createElement(PermissionRequestCard, {
        event,
        sessionId: 's-1',
        pending: false,
        outcome: 'allowed',
      }),
    )
    expect(approvedMarkup).toContain('Allowed · git status')
    expect(approvedMarkup).not.toContain('Allow once')
    // An approval saved for the project says so and can be forgotten.
    const savedMarkup = renderToStaticMarkup(
      createElement(PermissionRequestCard, { event, sessionId: 's-1', pending: false, outcome: 'allowed-project' }),
    )
    expect(savedMarkup).toContain('Allowed for this project · git status')
    expect(savedMarkup).toContain('Forget')

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

    // A new project's card names where its folder goes and offers to change it before creating.
    const projectMarkup = renderToStaticMarkup(
      createElement(PermissionRequestCard, {
        event: { ...event, projectLocation: { name: 'shop', parent: '/home/ana/Projects' } },
        sessionId: 's-1',
        pending: true,
        outcome: undefined,
      }),
    )
    expect(projectMarkup).toContain('/home/ana/Projects')
    expect(projectMarkup).toContain('Change…')
    expect(projectMarkup).toContain('Create project')
    expect(projectMarkup).toContain('Not now')
    expect(projectMarkup).not.toContain('Allow once')

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
