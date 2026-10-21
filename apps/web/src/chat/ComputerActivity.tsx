import { useCallback, useEffect, useRef, useState } from 'react'
import { Monitor } from 'lucide-react'
import type { ComputerSessionSummary } from '@ramu/shared/api'
import { COMPUTER_FRAME_STALE_MS, type ComputerAction } from '@ramu/shared/computerBridge'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { useHost } from '../workspace/HostProvider'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { Dropdown } from '../Menu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { controllerLabel } from './computerLabels'
import { ComputerSharing } from './ComputerSharing'
import { ComposerTraySection } from '../composer/ComposerTraySection'

type Frame = { data: string; mimeType: string; width: number; height: number; capturedAt: number; generation: number }

/** Polling stops with the dialog: an observation-only viewer costs nothing when it is closed. */
function Viewer({
  taskId,
  session,
  onClose,
  run,
}: {
  taskId: string
  session: ComputerSessionSummary
  onClose(): void
  run: (work: () => Promise<unknown>) => Promise<void>
}) {
  const { invoke } = useHost()
  const [frame, setFrame] = useState<Frame | null>(null)
  const [now, setNow] = useState(Date.now())
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const human = session.controller.kind === 'human'
  useEffect(() => {
    let active = true
    const tick = async () => {
      try {
        const next = await invoke('computer.frame', taskId)
        if (active) {
          setFrame(next)
          setError('')
        }
      } catch (reason) {
        if (active) setError(t(errorText(reason)))
      }
    }
    void tick()
    const timer = setInterval(() => {
      setNow(Date.now())
      void tick()
    }, 500)
    return () => {
      active = false
      clearInterval(timer)
      // A human controller that closes the viewer pauses input rather than leaving it open unseen.
      void invoke('computer.disconnect', taskId).catch(() => {})
    }
  }, [invoke, taskId])
  const stale = !!frame && now - frame.capturedAt > COMPUTER_FRAME_STALE_MS
  const send = (action: ComputerAction) => {
    if (!frame || stale) return
    void run(() => invoke('computer.input', taskId, frame.generation, frame.capturedAt, action))
  }
  const image = useRef<HTMLImageElement>(null)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{session.target.name}</DialogTitle>
          <DialogDescription>
            {t(controllerLabel(session))} ·{' '}
            {error
              ? error
              : !frame
                ? t('Connecting…')
                : stale
                  ? t('Last frame · {0}', { 0: new Date(frame.capturedAt).toLocaleTimeString() })
                  : t('Live')}
          </DialogDescription>
        </DialogHeader>
        {frame && (
          <img
            ref={image}
            alt={t('Computer screen')}
            className={human && !stale ? 'w-full cursor-crosshair rounded border' : 'w-full rounded border'}
            src={`data:${frame.mimeType};base64,${frame.data}`}
            onClick={(event) => {
              if (!human || !image.current) return
              const box = image.current.getBoundingClientRect()
              send({
                kind: 'click',
                x: Math.min(
                  frame.width - 1,
                  Math.max(0, Math.round(((event.clientX - box.left) / box.width) * frame.width)),
                ),
                y: Math.min(
                  frame.height - 1,
                  Math.max(0, Math.round(((event.clientY - box.top) / box.height) * frame.height)),
                ),
              })
            }}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {human ? (
            <>
              <form
                className="flex min-w-0 flex-1 gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!text) return
                  send({ kind: 'type', text })
                  setText('')
                }}
              >
                <Input
                  aria-label={t('Type on the computer')}
                  value={text}
                  maxLength={2000}
                  onChange={(event) => setText(event.target.value)}
                />
                <Button size="sm" disabled={!text || stale}>
                  {t('Send')}
                </Button>
              </form>
              {(['Enter', 'Tab', 'Escape', 'Backspace'] as const).map((key) => (
                <Button
                  key={key}
                  size="sm"
                  variant="secondary"
                  disabled={stale}
                  onClick={() => send({ kind: 'key', key })}
                >
                  {key}
                </Button>
              ))}
              <Button size="sm" onClick={() => void run(() => invoke('computer.giveToAgent', taskId))}>
                {t('Give control to agent')}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => void run(() => invoke('computer.takeControl', taskId))}>
              {t('Take control')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Shows only when computer use is on for this host. The grant is per thread and explicit. */
export function ComputerActivity({ taskId, visible }: { taskId: string | undefined; visible: boolean }) {
  useLanguage()
  const { invoke } = useHost()
  const [enabled, setEnabled] = useState(false)
  const [session, setSession] = useState<ComputerSessionSummary | null>(null)
  const [error, setError] = useState('')
  const [viewing, setViewing] = useState(false)
  const [apps, setApps] = useState<string[]>([])
  const [appHint, setAppHint] = useState('')
  const [app, setApp] = useState('')
  const load = useCallback(async () => {
    if (!taskId) return
    const status = await invoke('computer.status').catch(() => null)
    const appsReady = !!status?.apps?.available
    setEnabled(!!status?.enabled && (status.runtime.available || appsReady))
    setAppHint(status?.apps && !status.apps.available ? (status.apps.detail ?? '') : '')
    setSession(status?.enabled ? await invoke('computer.session', taskId).catch(() => null) : null)
    if (status?.enabled && appsReady) setApps(await invoke('computer.apps').catch(() => []))
  }, [invoke, taskId])
  useEffect(() => {
    if (!taskId || !visible) return
    void load()
    const timer = setInterval(() => void load(), 2000)
    return () => clearInterval(timer)
  }, [load, taskId, visible])
  const run = async (work: () => Promise<unknown>) => {
    setError('')
    try {
      await work()
    } catch (reason) {
      setError(t(errorText(reason)))
    }
    await load()
  }
  if (!taskId || !enabled) return null
  return (
    <ComposerTraySection aria-label={t('Computer')} title={t('Computer')} icon={<Monitor />}>
      <div className="flex flex-col gap-2 text-control">
        {session ? (
          <>
            <span className="text-caption text-muted-foreground">
              {session.target.name} · {t(controllerLabel(session))}
            </span>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setViewing(true)}>
                {t('View computer')}
              </Button>
              {session.controller.kind === 'human' ? (
                <Button size="sm" onClick={() => void run(() => invoke('computer.giveToAgent', taskId))}>
                  {t('Give control to agent')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void run(() => invoke('computer.takeControl', taskId))}
                >
                  {t('Take control')}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => void run(() => invoke('computer.stop', taskId))}>
                {t('Stop computer use')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void run(() => invoke('computer.revoke', taskId))}>
                {t('Revoke access')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="text-caption text-muted-foreground">
              {t('Allow this thread to see and control your main display. Revoke it any time.')}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {apps.length > 0 && (
                <>
                  <Dropdown
                    label={t('App')}
                    value={app}
                    options={[
                      { value: '', label: t('Choose an app') },
                      ...apps.map((name) => ({ value: name, label: name })),
                    ]}
                    onChange={setApp}
                  />
                  <Button
                    size="sm"
                    disabled={!app}
                    onClick={() =>
                      void run(() => invoke('computer.grant', taskId, { observe: true, input: true, app }))
                    }
                  >
                    {t('Allow this app')}
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant={apps.length ? 'secondary' : 'default'}
                onClick={() => void run(() => invoke('computer.grant', taskId, { observe: true, input: true }))}
              >
                {t('Allow main display')}
              </Button>
            </div>
            {appHint && <span className="text-caption text-muted-foreground">{t(appHint)}</span>}
          </>
        )}
        {error && (
          <span role="alert" className="text-caption text-destructive">
            {error}
          </span>
        )}
      </div>
      {viewing && session && <Viewer taskId={taskId} session={session} run={run} onClose={() => setViewing(false)} />}
    </ComposerTraySection>
  )
}
