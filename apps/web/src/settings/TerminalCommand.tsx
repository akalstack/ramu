import { useEffect, useState } from 'react'
import type { TerminalCommandStatus } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { invoke } from '../ipc'
import { t } from '../i18n'
import { errorText } from '../lib/errors'

/**
 * The `ramu` command for this computer's terminals. The desktop answers for its own computer, whichever host the window
 * shows; null until it has, and while this app cannot offer one (a development run or Windows).
 */
export function useTerminalCommand(onError: (message: string) => void) {
  const [status, setStatus] = useState<TerminalCommandStatus | null>(null),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    void invoke('terminalCommand.status').then(
      (next) => live && setStatus(next),
      () => {},
    )
    return () => {
      live = false
    }
  }, [])
  const run = async (method: 'terminalCommand.install' | 'terminalCommand.remove') => {
    setBusy(true)
    onError('')
    try {
      setStatus(await invoke(method))
    } catch (e) {
      onError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const shown = status && status.unavailable !== 'development' && status.unavailable !== 'platform' ? status : null
  return {
    status: shown,
    busy,
    install: () => run('terminalCommand.install'),
    remove: () => run('terminalCommand.remove'),
  }
}

/** The command's folder, shown as the person would type it. */
const folder = (path: string) => path.replace(/\/ramu$/, '').replace(/^\/(?:Users|home)\/[^/]+/, '~')

/** One line on where the command stands, and what to do next. */
export function terminalCommandHelp(status: TerminalCommandStatus): string {
  if (status.unavailable === 'appimage')
    return t('An AppImage moves each time it opens. Install the .deb or .rpm package to get the ramu command.')
  if (status.unavailable === 'translocated')
    return t('Move Ramu to your Applications folder and open it again, then install the ramu command here.')
  if (status.taken) return t('{0} belongs to another program, so Ramu leaves it alone.', { 0: status.path })
  if (status.installed)
    return status.onPath
      ? t('Open a new terminal window and run ramu --help. It uses this app, so it always matches it.')
      : t('Installed in {0}. Add that folder to your PATH to run ramu by name.', { 0: folder(status.path) })
  return t(
    'Start threads, pair devices and check this computer from any terminal. It runs inside this app, so nothing else is installed.',
  )
}

/** Install, or Remove once installed; nothing while it cannot be installed. */
export function TerminalCommandButton({ command }: { command: ReturnType<typeof useTerminalCommand> }) {
  const status = command.status
  if (!status || status.unavailable || status.taken) return null
  return status.installed ? (
    <Button variant="secondary" disabled={command.busy} onClick={() => void command.remove()}>
      {t('Remove')}
    </Button>
  ) : (
    <Button variant="default" disabled={command.busy} onClick={() => void command.install()}>
      {t('Install')}
    </Button>
  )
}
