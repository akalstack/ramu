import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The highlighter needs a browser; the header is what is under test.
vi.mock('../src/editor/monaco', () => ({ monaco: { languages: { getLanguages: () => [] }, editor: {} } }))
vi.mock('../src/editor/shiki', () => ({ loadShikiLanguage: vi.fn() }))
vi.mock('../src/ipc', () => ({ copyText: vi.fn() }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text, useLanguage: () => 'en' }))
vi.mock('../src/chat/Notifications', () => ({ notifyError: vi.fn() }))
const { ChatCodeBlock } = await import('../src/chat/ChatCodeBlock')
const header = (source: string, hint?: string) => {
  const html = renderToStaticMarkup(createElement(ChatCodeBlock, { source, hint }))
  return html.match(/data-slot="code-block-title"[^>]*>(.*?)<\/div>/s)?.[1] ?? html
}

describe('ChatCodeBlock header', () => {
  it('names the language with its file icon rather than an extension, as the phone does', () => {
    const shell = header('go test ./...', 'sh')
    expect(shell).toContain('Shell')
    expect(shell).not.toContain('.sh')
    expect(shell).toContain('<svg')
  })

  it('names the file a fence gives, and says Path for a lone path', () => {
    expect(header('export const a = 1', 'src/app.ts')).toContain('app.ts')
    expect(header('/Users/me/project/src')).toContain('Path')
  })
})

const { RunCommandContext } = await import('../src/chat/runCommandContext')
const render = (source: string, hint: string, run: ((command: string) => void) | null) =>
  renderToStaticMarkup(
    createElement(RunCommandContext.Provider, { value: run }, createElement(ChatCodeBlock, { source, hint })),
  )

describe('ChatCodeBlock Run', () => {
  it('offers Run on a shell block in a thread, and not on other code or outside a thread', () => {
    expect(render('vercel login', 'bash', () => {})).toContain('Run in terminal')
    expect(render('const a = 1', 'ts', () => {})).not.toContain('Run in terminal')
    expect(render('vercel login', 'bash', null)).not.toContain('Run in terminal')
  })
})
