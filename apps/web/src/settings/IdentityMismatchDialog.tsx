import { useEffect, useState } from 'react'
import type { IdentityMismatch } from '@ramu/shared/identities'
import { Button } from '@/components/desktop-button'
import { Dialog } from '../Menu'
import { t, useLanguage } from '../i18n'
import { invoke, ramu } from '../ipc'
import { errorText } from '../lib/errors'

/**
 * The guardrail's card: an action was about to act as another identity than its project's. **Continue as ‹other›**
 * lets it run once; **Use ‹project's›** opens Identities to put the right account in place. Nothing retries by itself.
 */
export function IdentityMismatchDialog() {
  useLanguage()
  const [mismatch, setMismatch] = useState<IdentityMismatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [continued, setContinued] = useState(false)
  useEffect(
    () =>
      ramu.on('identities:mismatch', (next) => {
        setMismatch(next)
        setContinued(false)
        setError(null)
      }),
    [],
  )
  if (!mismatch) return null
  const close = () => setMismatch(null)
  if (continued)
    return (
      <Dialog
        title={t('Continuing as {name}', { name: mismatch.actual.name })}
        confirmLabel={t('Done')}
        onConfirm={close}
        onCancel={close}
      >
        {t('Try the action again within ten minutes and it runs once as {name}.', { name: mismatch.actual.name })}
      </Dialog>
    )
  return (
    <Dialog
      title={t('This would act as {name}', { name: mismatch.actual.name })}
      confirmLabel={t('Use {name}', { name: mismatch.expected.name })}
      error={error}
      onCancel={close}
      onConfirm={() => {
        close()
        window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'identities' } }))
      }}
      extraActions={
        <Button
          variant="secondary"
          onClick={() =>
            void invoke('identities.continueAs', mismatch.projectId).then(
              () => setContinued(true),
              (cause) => setError(errorText(cause)),
            )
          }
        >
          {t('Continue as {name}', { name: mismatch.actual.name })}
        </Button>
      }
    >
      {t(
        '{action} would use an account of {actual} ({actualEmail}), but this project is {expected} ({expectedEmail}).',
        {
          action: t(mismatch.action),
          actual: mismatch.actual.name,
          actualEmail: mismatch.actual.email,
          expected: mismatch.expected.name,
          expectedEmail: mismatch.expected.email,
        },
      )}
    </Dialog>
  )
}
