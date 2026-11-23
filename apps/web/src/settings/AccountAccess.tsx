import { useCallback, useEffect, useState } from 'react'
import type { AccountStatus, AccountTrust, ListedHostInfo } from '@ramu/shared/account'
import type { Computer } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Dropdown } from '../Menu'
import { notifyError } from '../chat/Notifications'
import { useViewOnly } from '../composer/useViewOnly'
import { t } from '../i18n'
import { invoke as onThisComputer, ramu } from '../ipc'
import { errorText } from '../lib/errors'
import { SettingsCard, SettingsCardList } from './cards'
import { useSettingsEvents, useSettingsInvoke } from './SettingsScope'

type AccountAccess = 'off' | AccountTrust

const openAccount = () => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'account' } }))
const when = (time: number) => new Date(time).toLocaleString()

/**
 * Whether devices signed in to this host's Ramu account may connect without a code, and with what access, as one
 * choice beside Pair a device. Listing the host is what lets them find it, so Off unlists it. Nothing for a host too
 * old to have the account.
 */
export function AccountDevicesRow() {
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
  if (!status.signedIn)
    return (
      <SettingsRow>
        <SettingsLabel
          title={t('Devices on your Ramu account')}
          help={t(
            'Sign in to your Ramu account and your phone and other computers signed in to it connect without a code.',
          )}
        />
        <Button variant="secondary" size="sm" onClick={openAccount}>
          {t('Sign in…')}
        </Button>
      </SettingsRow>
    )
  const current: AccountAccess = status.listed ? status.trust : 'off'
  const choose = (next: AccountAccess) => {
    setChoosing(next)
    const change =
      next === 'off'
        ? invoke('account.setListed', false)
        : status.listed
          ? invoke('account.setTrust', next)
          : invoke('account.setListed', true, next)
    void change
      .then(reload, (cause) => notifyError(errorText(cause), t('Ramu account')))
      .finally(() => setChoosing(null))
  }
  return (
    <SettingsRow>
      <SettingsLabel
        title={t('Devices on your Ramu account')}
        help={
          current === 'off'
            ? t('Your phone and other computers signed in to {0} pair with a code, like any device.', {
                0: status.user?.email ?? '',
              })
            : t(
                'Devices signed in to {0} find this host and connect. The account learns its name, never its address.',
                {
                  0: status.user?.email ?? '',
                },
              )
        }
      />
      <Dropdown
        label={t('Devices on your Ramu account')}
        value={choosing ?? current}
        disabled={viewOnly || choosing !== null}
        options={[
          { value: 'owner', label: t('Connect with full access') },
          { value: 'viewer', label: t('Connect view-only') },
          { value: 'ask', label: t('Ask me here first') },
          { value: 'off', label: t('Off: pair with a code') },
        ]}
        onChange={(value) => choose(value as AccountAccess)}
      />
    </SettingsRow>
  )
}

/**
 * Hosts listed on this device's Ramu account that it does not use yet, under Hosts you use. Ones that let the account
 * in are added on their own; this offers the rest (a host that asks first, or one forgotten here) with one tap.
 */
export function AccountHostsList({ computers }: { computers: Computer[] }) {
  const [hosts, setHosts] = useState<ListedHostInfo[]>([])
  const [pairing, setPairing] = useState<ListedHostInfo | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const read = useCallback(() => void onThisComputer('account.hosts').then(setHosts, () => setHosts([])), [])
  useEffect(() => {
    read()
    return ramu.on('account:changed', read)
  }, [read])
  useEffect(() => ramu.on('computers:pairCode', ({ code: shown }) => setCode(shown)), [])
  const saved = new Set(computers.flatMap((computer) => (computer.hostId ? [computer.hostId] : [])))
  const missing = hosts.filter((host) => !saved.has(host.hostKey))
  if (!missing.length) return null
  const add = async (host: ListedHostInfo) => {
    setCode(null)
    setPairing(host)
    try {
      await onThisComputer('computers.pairThroughAccount', host.id, host.name)
      read()
    } catch (cause) {
      notifyError(errorText(cause), t('Hosts'))
    } finally {
      setCode(null)
      setPairing(null)
    }
  }
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <span className="text-caption font-medium text-muted-foreground">{t('On your Ramu account')}</span>
      <SettingsCardList>
        {missing.map((host) => (
          <SettingsCard
            key={host.id}
            title={host.name}
            meta={
              host.trust === 'ask'
                ? t('Last seen {time} · asks before connecting', { time: when(host.lastSeen) })
                : t('Last seen {time} · connects without asking', { time: when(host.lastSeen) })
            }
            actions={
              <Button size="sm" variant="secondary" disabled={pairing !== null} onClick={() => void add(host)}>
                {host.trust === 'ask' ? t('Add this host') : t('Connect')}
              </Button>
            }
          />
        ))}
      </SettingsCardList>
      {pairing && (
        <p role="status" className="m-0 text-caption text-muted-foreground">
          {pairing.trust !== 'ask' || !code
            ? t('Connecting to {0}…', { 0: pairing.name })
            : t('Allow this computer on the host when it shows {code}.', { code })}
        </p>
      )}
    </div>
  )
}
