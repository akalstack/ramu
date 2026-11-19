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
  onClose,
}: {
  /** The method this account signed in with last, chosen again so a sign-in after expiry is one click. */
  current?: string
  /** Which key variables the host already has for Antigravity, so a saved key need not be typed again. */
  hasKey: (method: AntigravitySignInMethod) => boolean
  onSubmit: (input: SignIn) => Promise<void>
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
  const submit = () => {
    setBusy(true)
    setError(null)
    onSubmit(input).then(onClose, (reason) => {
      setBusy(false)
      setError(errorText(reason))
    })
  }
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
