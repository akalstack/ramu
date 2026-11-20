import { useState } from 'react'
import {
  ANTIGRAVITY_SIGN_IN_METHODS,
  antigravitySignInProblem,
  type AntigravitySignIn as SignIn,
  type AntigravitySignInMethod,
} from '@ramu/shared/providers/environment'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { RowButton } from '@/components/row-button'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { invoke } from '../ipc'

const METHODS: { id: AntigravitySignInMethod; title: string; help: string; note?: string }[] = [
  {
    id: 'oauth-personal',
    title: 'Google account',
    help: 'Sign in with Google in your browser.',
    note: 'Google may limit personal plans used outside its own apps. A Gemini API key avoids that.',
  },
  {
    id: 'oauth-business',
    title: 'Gemini Enterprise',
    help: 'Sign in with your work account in your browser, billed to a Google Cloud project.',
  },
  { id: 'gemini-api-key', title: 'Gemini API key', help: 'Use a key from Google AI Studio.' },
  {
    id: 'agent-platform',
    title: 'Agent Platform',
    help: 'Gemini Enterprise Agent Platform (formerly Vertex AI), with an API key or Google Cloud credentials.',
  },
]

/**
 * Chooses how Antigravity signs in. Browser methods open Google's sign-in; an API key is kept with the host's
 * provider variables in its credential store, and a Google Cloud project goes to the runtime's own settings.
 */
export function AntigravitySignIn({
  current,
  hasKey,
  onSubmit,
  onCode,
  onClose,
}: {
  /** The method this account signed in with last, chosen again so a sign-in after expiry is one click. */
  current?: string
  /** Which key variables the host already has for Antigravity, so a saved key need not be typed again. */
  hasKey: (method: AntigravitySignInMethod) => boolean
  /** Resolves with Google's page when the sign-in finishes with a code pasted from it. */
  onSubmit: (input: SignIn) => Promise<{ url: string } | void>
  /** Finishes a browser sign-in with the pasted code; null abandons it. */
  onCode: (code: string | null) => Promise<void>
  onClose: () => void
}) {
  const [method, setMethod] = useState<AntigravitySignInMethod>(
    ANTIGRAVITY_SIGN_IN_METHODS.find((entry) => entry === current) ?? 'oauth-personal',
  )
  const [apiKey, setApiKey] = useState('')
  const [gcpProject, setProject] = useState('')
  const [gcpLocation, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input: SignIn = { method, apiKey, gcpProject, gcpLocation }
  const problem = antigravitySignInProblem(input, hasKey(method))
  const browser = method === 'oauth-personal' || method === 'oauth-business'
  /** Google's page while a browser sign-in waits for the code it shows. */
  const [page, setPage] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const open = (url: string) => void invoke('app.openExternal', url).catch(() => {})
  const submit = () => {
    setBusy(true)
    setError(null)
    onSubmit(input).then(
      (started) => {
        setBusy(false)
        if (!started) return onClose()
        setPage(started.url)
        open(started.url)
      },
      (reason) => {
        setBusy(false)
        setError(errorText(reason))
      },
    )
  }
  const finish = () => {
    setBusy(true)
    setError(null)
    onCode(code.trim()).then(onClose, (reason) => {
      setBusy(false)
      setError(errorText(reason))
    })
  }
  const close = () => {
    if (page) void onCode(null).catch(() => {})
    onClose()
  }
  if (page)
    return (
      <Dialog open onOpenChange={(next) => !next && !busy && close()}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t('Sign in to Antigravity')}</DialogTitle>
            <DialogDescription>
              {t('Allow access on the Google page, then paste the code it shows here.')}
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5 text-caption">
            {t('Code from Google')}
            <Input
              autoFocus
              autoComplete="off"
              maxLength={16384}
              value={code}
              disabled={busy}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && code.trim() && !busy) finish()
              }}
            />
          </label>
          {error && (
            <p className="m-0 text-caption text-bad" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => open(page)}>
              {t('Open the page again')}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={close}>
              {t('Cancel')}
            </Button>
            <Button disabled={busy || !code.trim()} onClick={finish}>
              {busy ? t('Signing in…') : t('Sign in')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('Sign in to Antigravity')}</DialogTitle>
          <DialogDescription>{t('Choose how this account signs in.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1" role="radiogroup" aria-label={t('Sign-in method')}>
          {METHODS.map((entry) => (
            <RowButton
              key={entry.id}
              size="lg"
              stacked
              role="radio"
              aria-checked={method === entry.id}
              aria-pressed={method === entry.id}
              className="rounded-(--radius-m) px-3 py-2.5"
              disabled={busy}
              onClick={() => setMethod(entry.id)}
            >
              <span className="text-body font-medium">{t(entry.title)}</span>
              <span className="text-caption text-muted-foreground">{t(entry.help)}</span>
              {entry.note && method === entry.id && <span className="text-caption text-warn">{t(entry.note)}</span>}
            </RowButton>
          ))}
        </div>
        {(method === 'gemini-api-key' || method === 'agent-platform') && (
          <label className="flex flex-col gap-1.5 text-caption">
            {t('API key')}
            <Input
              type="password"
              autoComplete="off"
              maxLength={512}
              value={apiKey}
              placeholder={hasKey(method) ? t('Saved on this host. Enter a new one to replace it.') : ''}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
        )}
        {(method === 'oauth-business' || method === 'agent-platform') && (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-caption">
              {t('Google Cloud project')}
              <Input maxLength={128} value={gcpProject} onChange={(event) => setProject(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5 text-caption">
              {t('Location')}
              <Input
                maxLength={128}
                placeholder="us-central1"
                value={gcpLocation}
                onChange={(event) => setLocation(event.target.value)}
              />
            </label>
          </div>
        )}
        {error && (
          <p className="m-0 text-caption text-bad" role="alert">
            {error}
          </p>
        )}
        {busy && browser && (
          <p className="m-0 text-caption text-muted-foreground" role="status">
            {t('Finish signing in in your browser.')}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button disabled={busy || !!problem} title={problem ? t(problem) : undefined} onClick={submit}>
            {busy ? t('Signing in…') : browser ? t('Continue in browser') : t('Sign in')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
