import { t, useLanguage } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/desktop-button'
import { TerminalView } from '../views/TerminalView'
import { ramu } from '../ipc'
import { signInLinkIn } from './signInLink'

type SetupCommand = { id: string; title: string; command: string }
const OPEN = 'ramu:provider-terminal'
const CLOSE = 'ramu:provider-terminal-close'
const CLOSED = 'ramu:provider-terminal-closed'
/** How long a sign-in is followed before the person is left to close the terminal themselves. */
const WATCH_MS = 10 * 60_000

export function runProviderCommand(title: string, command: string) {
  window.dispatchEvent(new CustomEvent<SetupCommand>(OPEN, { detail: { id: crypto.randomUUID(), title, command } }))
}

/**
 * Follows a sign-in started in the setup terminal, so the account shows as signed in without a manual refresh: `check`
 * runs every few seconds and once more when the terminal closes; when it reports success the terminal closes itself.
 */
export function useSignInWatch(check: () => Promise<boolean>) {
  const latest = useRef(check)
  latest.current = check
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])
  return () => {
    stop.current?.()
    const started = Date.now()
    let done = false
    const finish = () => {
      done = true
      clearInterval(timer)
      window.removeEventListener(CLOSED, closed)
    }
    const closed = () => {
      if (done) return
      finish()
      void latest.current().catch(() => false)
    }
    const timer = setInterval(() => {
      if (Date.now() - started > WATCH_MS) return finish()
      void latest.current().then(
        (signedIn) => {
          if (!signedIn || done) return
          finish()
          window.dispatchEvent(new Event(CLOSE))
        },
        () => {},
      )
    }, 3000)
    window.addEventListener(CLOSED, closed)
    stop.current = finish
  }
}

/** A regular interactive PTY, kept separate from project terminals and the Settings draft. */
export function ProviderSetupTerminal() {
  useLanguage()
  const [setup, setSetup] = useState<SetupCommand | null>(null)
  // The sign-in page opens by itself the first time the command prints its link, so nobody has to click it.
  const output = useRef('')
  const opened = useRef(false)
  const close = () => {
    setSetup(null)
    window.dispatchEvent(new Event(CLOSED))
  }
  useEffect(() => {
    const open = (event: Event) => {
      output.current = ''
      opened.current = false
      setSetup((event as CustomEvent<SetupCommand>).detail)
    }
    const closeRequested = () => close()
    window.addEventListener(OPEN, open)
    window.addEventListener(CLOSE, closeRequested)
    return () => {
      window.removeEventListener(OPEN, open)
      window.removeEventListener(CLOSE, closeRequested)
    }
  }, [])
  const watchOutput = (data: string) => {
    if (opened.current) return
    output.current = (output.current + data).slice(-16_000)
    const link = signInLinkIn(output.current)
    if (!link) return
    opened.current = true
    void ramu.invoke('app.openExternal', link).catch(() => {})
  }
  return (
    <Dialog
      open={!!setup}
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent
        className="provider-terminal-dialog [&_.terminal-view]:h-full [&_.terminal-view]:min-h-0 w-[min(900px,_calc(100vw_-_48px))] sm:max-w-[900px] h-[min(520px,_calc(100vh_-_80px))] p-0 overflow-hidden"
        showCloseButton={false}
        aria-describedby={undefined}
        initialFocus={false}
      >
        <DialogTitle className="sr-only">{setup?.title ?? t('Provider setup terminal')}</DialogTitle>
        {setup && (
          <TerminalView
            key={setup.id}
            taskId="provider-setup"
            repoId={null}
            label={setup.title}
            active
            initialCommand={setup.command}
            onExit={close}
            onOutput={watchOutput}
            actions={
              <Button
                variant="ghost"
                size="icon-xs"
                className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
                aria-label={t('Close setup terminal')}
                onClick={close}
              >
                <X size={14} />
              </Button>
            }
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
