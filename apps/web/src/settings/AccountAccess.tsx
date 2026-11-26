import { useCallback, useEffect, useState } from 'react'
import type { ListedHostInfo } from '@ramu/shared/account'
import type { Computer } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { notifyError } from '../chat/Notifications'
import { t } from '../i18n'
import { invoke as onThisComputer, ramu } from '../ipc'
import { errorText } from '../lib/errors'
import { SettingsCard, SettingsCardList } from './cards'

const when = (time: number) => new Date(time).toLocaleString()

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
