import { useState } from 'react'
import { API_KEY_ISSUERS, MAX_API_KEY_LENGTH, PROVIDER_KEY_VARIABLES } from '@ramu/shared/providers/apiKeys'
import { providerName } from '@ramu/shared/providers/providers'
import type { AgentProvider } from '@ramu/shared/types'
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

/**
 * Signs one login in with an API key instead of a subscription. The key stays on the host: in the provider's own login
 * file where it keeps one (Codex), otherwise in the host credential store, passed only to this login's processes.
 */
export function ApiKeySignIn({
  provider,
  account,
  saved,
  onSubmit,
  onClose,
}: {
  provider: AgentProvider
  /** The login's name, so it is clear which one gets the key. */
  account: string
  /** The login already runs on an API key, so it can go back to its subscription. */
  saved: boolean
  onSubmit: (variable: string, key: string | null) => Promise<void>
  onClose: () => void
}) {
  const variables = PROVIDER_KEY_VARIABLES[provider]
  const [variable, setVariable] = useState(variables[0] ?? '')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = (value: string | null) => {
    setBusy(true)
    setError(null)
    onSubmit(variable, value).then(onClose, (reason) => {
      setBusy(false)
      setError(errorText(reason))
    })
  }
  const issuer = API_KEY_ISSUERS[variable] ?? providerName(provider)
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t('Use an API key for {0}', { '0': account })}</DialogTitle>
          <DialogDescription>
            {t(
              'Usage is billed to the key instead of your plan. The key stays on this computer and is used only by this login.',
            )}
          </DialogDescription>
        </DialogHeader>
        {variables.length > 1 && (
          <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label={t('Model provider')}>
            {variables.map((name) => (
              <RowButton
                key={name}
                role="radio"
                aria-checked={variable === name}
                aria-pressed={variable === name}
                className="rounded-(--radius-m) px-3 py-2"
                disabled={busy}
                onClick={() => setVariable(name)}
              >
                {API_KEY_ISSUERS[name] ?? name}
              </RowButton>
            ))}
          </div>
        )}
        <label className="flex flex-col gap-1.5 text-caption">
          {t('{0} API key', { '0': issuer })}
          <Input
            type="password"
            autoComplete="off"
            autoFocus
            maxLength={MAX_API_KEY_LENGTH}
            value={key}
            disabled={busy}
            placeholder={saved ? t('Saved on this host. Enter a new one to replace it.') : ''}
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && key.trim() && !busy) run(key.trim())
            }}
          />
        </label>
        {error && (
          <p className="m-0 text-caption text-bad" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          {saved && (
            <Button variant="ghost" className="mr-auto" disabled={busy} onClick={() => run(null)}>
              {t('Remove key')}
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button disabled={busy || !key.trim()} onClick={() => run(key.trim())}>
            {busy ? t('Saving…') : t('Save key')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
