import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { ThemeVariant } from '@ramu/shared/theme'
import type { ResolvedAppearance } from '../appearance'
import { terminalThemeForVariant } from './terminalTheme'
import { useNearViewport } from '../lib/useNearViewport'
import { t } from '../i18n'

/** A real xterm surface with local sample output; it never opens a shell or forwards input. */
export function TerminalThemePreview({
  variant,
  appearance,
}: {
  variant: ThemeVariant
  appearance: ResolvedAppearance
}) {
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const near = useNearViewport(host, true, false)
  const palette = terminalThemeForVariant(variant, appearance)
  const currentPalette = useRef(palette)
  currentPalette.current = palette
  useEffect(() => {
    if (!near || !host.current) return
    const term = new Terminal({
      theme: currentPalette.current,
      fontFamily: '"Geist Mono Variable", monospace',
      fontSize: 12,
      lineHeight: 1.25,
      disableStdin: true,
      screenReaderMode: true,
      scrollback: 0,
    })
    terminal.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current)
    const resize = new ResizeObserver(() => fit.fit())
    resize.observe(host.current)
    fit.fit()
    term.write(
      '$ pnpm test\r\n\x1b[32mPASS\x1b[0m app.test.ts\r\n\x1b[33mWARN\x1b[0m optional check skipped\r\n\x1b[31mFAIL\x1b[0m retry.test.ts\r\n\x1b[34minfo\x1b[0m 3 files checked\r\n',
    )
    return () => {
      resize.disconnect()
      terminal.current = null
      term.dispose()
    }
  }, [near])
  useEffect(() => {
    if (terminal.current) terminal.current.options.theme = palette
  }, [palette])
  return (
    <div
      ref={host}
      role="region"
      aria-label={t('Terminal theme preview')}
      className="h-32 min-w-0 overflow-hidden rounded-(--radius-s) bg-(--code-bg) p-2"
    />
  )
}
