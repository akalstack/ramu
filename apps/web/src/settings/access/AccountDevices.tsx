import { useCallback, useEffect, useState } from 'react'
import type { AccountStatus } from '@ramu/shared/account'
import { Button } from '@/components/desktop-button'
import { SettingsAdvanced, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Switch } from '@/components/ui/switch'
import { notifyError } from '../../chat/Notifications'
import { useViewOnly } from '../../composer/useViewOnly'
import { t } from '../../i18n'
import { errorText } from '../../lib/errors'
import { useSettingsEvents, useSettingsInvoke } from '../SettingsScope'
import { AccessSection } from './AccessSection'
import { accountAccess, accountSwitches, type AccountAccess, type AccountSwitches } from './accountTrust'

const openAccount = () => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'account' } }))

/**
 * Whether devices signed in to this host's Ramu account connect without a code, and whether the person allows each
 * here first. Listing the host is what lets them find it, so turning it off unlists it. View-only access for them
 * waits under Advanced. Nothing for a host too old to have the account.
 */
export function AccountDevices() {
  const invoke = useSettingsInvoke()
  const on = useSettingsEvents()
  const viewOnly = useViewOnly()
  const [status, setStatus] = useState<AccountStatus | null>(null)
  const [choosing, setChoosing] = useState<AccountAccess | null>(null)
  const reload = useCallback(() => invoke('account.status').then(setStatus, () => setStatus(null)), [invoke])
  useEffect(() => {
    void reload()
    return on('account:changed', () => void reload())
  }, [on, reload])
  if (!status) return null
  const title = t('Devices on your Ramu account')
  if (!status.signedIn)
    return (
      <AccessSection title={title}>
        <SettingsRow>
          <SettingsLabel
            title={t('Connect devices on my Ramu account')}
            help={t(
              'Sign in to your Ramu account and your phone and other computers signed in to it connect without a code.',
            )}
          />
          <Button variant="secondary" size="sm" onClick={openAccount}>
            {t('Sign in…')}
          </Button>
        </SettingsRow>
      </AccessSection>
    )
  const current: AccountAccess = choosing ?? (status.listed ? status.trust : 'off')
  const switches = accountSwitches(current)
  const set = (change: Partial<AccountSwitches>) => {
    const next = accountAccess({ ...switches, ...change })
    if (next === current) return
    setChoosing(next)
    const saved =
      next === 'off'
        ? invoke('account.setListed', false)
        : status.listed
          ? invoke('account.setTrust', next)
          : invoke('account.setListed', true, next)
    void saved
      .then(reload, (cause) => notifyError(errorText(cause), t('Ramu account')))
      .finally(() => setChoosing(null))
  }
  const email = status.user?.email ?? ''
  const disabled = viewOnly || choosing !== null
  return (
    <AccessSection title={title}>
      <SettingsRow className="settings-toggle">
        <SettingsLabel
          title={t('Connect devices on my Ramu account')}
          help={
            !switches.connect
              ? t('Your phone and other computers signed in to {0} pair with a code, like any device.', { 0: email })
              : switches.viewOnly
                ? t(
                    'Devices signed in to {0} find this host and connect view-only. The account learns its name, never its address.',
                    { 0: email },
                  )
                : t(
                    'Devices signed in to {0} find this host and connect. The account learns its name, never its address.',
                    { 0: email },
                  )
          }
        />
        <Switch
          aria-label={t('Connect devices on my Ramu account')}
          checked={switches.connect}
          disabled={disabled}
          onCheckedChange={(connect) => set({ connect })}
        />
      </SettingsRow>
      {switches.connect && (
        <SettingsRow className="settings-toggle">
          <SettingsLabel
            title={t('Ask me first')}
            help={t(
              'Each new device waits until you allow it here and both screens show the same number. Use it when this host holds anything sensitive.',
            )}
          />
          <Switch
            aria-label={t('Ask me first')}
            checked={switches.ask}
            disabled={disabled}
            onCheckedChange={(ask) => set({ ask })}
          />
        </SettingsRow>
      )}
      {switches.connect && !switches.ask && (
        <SettingsAdvanced className="mt-0">
          <SettingsRow className="settings-toggle">
            <SettingsLabel
              title={t('Connect them view-only')}
              help={t('They read threads and answer requests, but can’t start threads, change files or run commands.')}
            />
            <Switch
              aria-label={t('Connect them view-only')}
              checked={switches.viewOnly}
              disabled={disabled}
              onCheckedChange={(next) => set({ viewOnly: next })}
            />
          </SettingsRow>
        </SettingsAdvanced>
      )}
    </AccessSection>
  )
}
