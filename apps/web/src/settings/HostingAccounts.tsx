import { useCallback, useEffect, useRef, useState } from 'react'
import type { ForgeConnectionSummary } from '@ramu/shared/types'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { useSettingsInvoke } from './SettingsScope'
import { accountDetail, connectionHeadline } from './hostingStatus'

/** Providers shown for orientation only: no setup, no network calls, no background work until they are built. */
const COMING_SOON = ['GitLab', 'Bitbucket Cloud', 'Azure DevOps'] as const

/** GitHub from the sign-ins the host's `gh` already holds, and the providers that are not built yet. */
export function HostingAccounts() {
  useLanguage()
  const invoke = useSettingsInvoke()
  const [summary, setSummary] = useState<ForgeConnectionSummary | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const request = useRef(0)
  const check = useCallback(() => {
    const mine = ++request.current
    setBusy(true)
    setFailed(false)
    invoke('forge.connections').then(
      (next) => {
        if (mine !== request.current) return
        setSummary(next)
        setBusy(false)
      },
      (error) => {
        if (mine !== request.current) return
        // An older host has no such method: say nothing is known rather than that nothing is connected.
        setFailed(true)
        setBusy(false)
        void errorText(error)
      },
    )
  }, [invoke])
  useEffect(() => {
    setSummary(null)
    check()
    return () => {
      ++request.current
    }
  }, [check])
  return (
    <>
      <SettingsGroupTitle>{t('Hosting accounts')}</SettingsGroupTitle>
      <SettingsRow>
        <SettingsLabel title="GitHub" help={connectionHeadline(summary, failed)} />
        <span className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={check}>
            {busy ? t('Checking…') : t('Check connection')}
          </Button>
          {summary && summary.accounts.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={open}
              aria-controls="github-accounts"
              onClick={() => setOpen((value) => !value)}
            >
              {open ? t('Hide details') : t('Details')}
            </Button>
          )}
        </span>
      </SettingsRow>
      {open && summary && (
        <ul id="github-accounts" className="m-0 mb-3 flex list-none flex-col gap-1 p-0 px-4 text-caption">
          {summary.accounts.map((account) => (
            <li key={`${account.host}:${account.login}`}>
              <strong>{account.login}</strong> <span className="text-muted-foreground">{account.host}</span>
              <div className="text-muted-foreground">{accountDetail(account)}</div>
            </li>
          ))}
        </ul>
      )}
      {COMING_SOON.map((name) => (
        <SettingsRow key={name}>
          <SettingsLabel title={name} />
          <span className="text-caption text-muted-foreground">{t('Coming soon')}</span>
        </SettingsRow>
      ))}
    </>
  )
}
