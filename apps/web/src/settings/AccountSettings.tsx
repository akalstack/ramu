import { useCallback, useEffect, useState } from 'react'
import { Copy, Download } from 'lucide-react'
import type { AccountStatus, AccountTrust, ListedHostInfo, RestoreChoice } from '@ramu/shared/account'
import type { SettingsExport, TransferChange } from '@ramu/shared/settingsTransfer'
import { defaultGroups } from '@ramu/shared/settingsTransfer'
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/desktop-checkbox'
import { Input } from '@/components/desktop-input'
import { Dialog, Dropdown } from '../Menu'
import { useViewOnly } from '../composer/useViewOnly'
import { t, useLanguage } from '../i18n'
import { copyText, invoke as onThisComputer, ramu } from '../ipc'
import { errorText } from '../lib/errors'
import { AccountProfileHeader } from './AccountProfile'
import { SETTINGS_CARD, SettingsCard, SettingsCardList, SettingsEmpty, SettingsSectionHead } from './cards'
import { useSettingsEvents, useSettingsInvoke } from './SettingsScope'

const when = (time: number | null) => (time ? new Date(time).toLocaleString() : t('never'))

/** The recovery code, shown once, with Copy and Save to a file. */
function RecoveryCode({ code, onClose }: { code: string; onClose: () => void }) {
  return (
    <Dialog title={t('Your recovery code')} confirmLabel={t('I saved it')} onConfirm={onClose} onCancel={onClose}>
      <div className="flex flex-col gap-2 text-control">
        <p className="m-0">
          {t(
            'Keep this code in a password manager. With it, a new machine opens your backups even when every other device is gone. Without any device and without the code, the backups cannot be opened, by you or by anyone.',
          )}
        </p>
        <code className="block rounded-(--radius-s) bg-fill p-2 text-center text-[15px] tracking-wider">{code}</code>
        <div className="flex gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => void copyText(code)}>
            <Copy size={13} />
            {t('Copy')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const link = document.createElement('a')
              link.href = URL.createObjectURL(new Blob([`Ramu recovery code\n${code}\n`], { type: 'text/plain' }))
              link.download = 'ramu-recovery-code.txt'
              link.click()
              URL.revokeObjectURL(link.href)
            }}
          >
            <Download size={13} />
            {t('Save to a file')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/**
 * Settings › Account: the optional Ramu account. Signing in backs settings up sealed on this host, so only your devices
 * can open them. Restore, recovery and Your hosts live here too: a listed host lets the account's devices connect with
 * the access chosen here, or asks first.
 */
export function AccountSettings() {
  useLanguage()
  const invoke = useSettingsInvoke()
  const on = useSettingsEvents()
  const viewOnly = useViewOnly()
  const [status, setStatus] = useState<AccountStatus | null>(null)
  const [recovery, setRecovery] = useState<string | null>(null)
  const [requests, setRequests] = useState<{ id: string; name: string; code: string | null; expiresAt: number }[]>([])
  const [asking, setAsking] = useState<{ code: string | null; done: boolean; error: string | null } | null>(null)
  const [code, setCode] = useState('')
  const [codeSource, setCodeSource] = useState<'account' | 'github'>('account')
  const [choices, setChoices] = useState<RestoreChoice[] | null>(null)
  const [restore, setRestore] = useState<{ file: SettingsExport; changes: TransferChange[]; from: string } | null>(null)
  const [hosts, setHosts] = useState<ListedHostInfo[]>([])
  const [pairCode, setPairCode] = useState<string | null>(null)
  const [pairingHost, setPairingHost] = useState<ListedHostInfo | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(() => {
    void invoke('account.status').then(setStatus, (cause) => setError(errorText(cause)))
  }, [invoke])
  useEffect(() => {
    reload()
    return on('account:changed', reload)
  }, [on, reload])
  const signedIn = !!status?.signedIn
  const hasKey = !!status?.backup.hasKey
  // While the page is open: requests from new devices, and this host's own request for the key.
  useEffect(() => {
    if (!signedIn) return
    const read = () => {
      if (hasKey) void invoke('account.keyRequests').then(setRequests, () => {})
      void invoke('account.keyRequestState').then(setAsking, () => {})
      void invoke('account.hosts').then(setHosts, () => {})
    }
    read()
    const timer = setInterval(read, 3000)
    return () => clearInterval(timer)
  }, [invoke, signedIn, hasKey])
  useEffect(() => ramu.on('computers:pairCode', ({ code: shown }) => setPairCode(shown)), [])
  const act = async (run: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await run()
      reload()
      return true
    } catch (cause) {
      setError(errorText(cause))
      return false
    } finally {
      setBusy(false)
    }
  }
  if (!status) return error ? <p className="text-bad">{error}</p> : null
  const pending = status.pendingSignIn
  return (
    <section className="flex flex-col gap-2" aria-label={t('Ramu account')}>
      <SettingsSectionHead
        title={t('Ramu account')}
        help={t(
          'Optional. It keeps settings backups that only your devices can open, and lists your hosts so your signed-in devices connect without a code. The account is run by Akalstack; only a host you list lets your devices in, with the access you choose there.',
        )}
      />
      {error && (
        <p role="alert" className="m-0 text-caption text-bad">
          {error}
        </p>
      )}
      {!signedIn && !pending && (
        <Button
          size="sm"
          className="self-start"
          disabled={viewOnly || busy}
          onClick={() => void act(() => invoke('account.signIn'))}
        >
          {t('Sign in')}
        </Button>
      )}
      {pending && (
        <SettingsCard
          title={t('Code: {code}', { code: pending.userCode })}
          meta={t('Sign in with GitHub, Google or a passkey, check the code matches and choose Approve.')}
          actions={
            <>
              <Button size="sm" onClick={() => void onThisComputer('app.openExternal', pending.verificationUri)}>
                {t('Open the sign-in page')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void act(() => invoke('account.cancelSignIn'))}>
                {t('Cancel')}
              </Button>
            </>
          }
        />
      )}
      {signedIn && status.user && (
        <article className={`${SETTINGS_CARD} flex-row! items-center gap-3 py-3`}>
          <AccountProfileHeader user={status.user} providers={status.providers} />
          <div className="flex flex-none items-center gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={viewOnly || busy}
              onClick={() => void act(() => invoke('account.signOut'))}
            >
              {t('Sign out')}
            </Button>
            <Button size="sm" variant="ghost" disabled={viewOnly || busy} onClick={() => setDeleting(true)}>
              {t('Delete account')}
            </Button>
          </div>
        </article>
      )}

      <SettingsSectionHead
        title={t('Back up settings')}
        help={t(
          'Theme, models, rules, commit style and identities, sealed on this host before they leave it. Credentials never leave the host.',
        )}
      />
      <div className="flex flex-col gap-1.5 text-control">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={status.backup.account}
            disabled={viewOnly || busy || !signedIn}
            onCheckedChange={(value) =>
              void act(async () => {
                const result = await invoke('account.setBackup', { account: value === true })
                if (result.recoveryCode) setRecovery(result.recoveryCode)
              })
            }
          />
          {t('To my Ramu account (the last 30 versions)')}
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={status.backup.github}
            disabled={viewOnly || busy}
            onCheckedChange={(value) =>
              void act(async () => {
                const result = await invoke('account.setBackup', { github: value === true })
                if (result.recoveryCode) setRecovery(result.recoveryCode)
              })
            }
          />
          {t('To a private gist on my GitHub (no Ramu account needed)')}
        </label>
        {(status.backup.account || status.backup.github) && (
          <p className="m-0 text-caption text-muted-foreground">
            {status.backup.error
              ? t('The last backup failed: {error}', { error: status.backup.error })
              : t('Last backup: {time}', { time: when(status.backup.lastBackupAt) })}
          </p>
        )}
        {hasKey && (
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              disabled={viewOnly || busy}
              onClick={() => void act(() => invoke('account.backupNow'))}
            >
              {t('Back up now')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={viewOnly || busy}
              onClick={() => void act(async () => setRecovery(await invoke('account.newRecoveryCode')))}
            >
              {t('New recovery code')}
            </Button>
            {status.backup.account && (
              <Button
                size="sm"
                variant="ghost"
                disabled={viewOnly || busy}
                onClick={() => void act(() => invoke('account.deleteBackups', 'account'))}
              >
                {t('Delete backups in the account')}
              </Button>
            )}
          </div>
        )}
      </div>

      {(signedIn || status.backup.github) && (
        <>
          <SettingsSectionHead
            title={t('Restore your settings')}
            help={t('From a backup another of your hosts or this one made. Nothing changes until you review it.')}
          />
          {!hasKey ? (
            <div className="flex flex-col gap-1.5">
              {signedIn && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={viewOnly || busy || !!asking}
                    onClick={() => void act(() => invoke('account.requestKey'))}
                  >
                    {t('Approve on another device')}
                  </Button>
                  {asking && (
                    <span className="text-caption text-muted-foreground">
                      {asking.error ??
                        (asking.code
                          ? t('Check that your other device shows {code}, then approve there.', { code: asking.code })
                          : t('Open Settings → Account on a device you have.'))}
                    </span>
                  )}
                </div>
              )}
              <form
                className="flex items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault()
                  void act(() => invoke('account.useRecoveryCode', code, codeSource)).then((ok) => ok && setCode(''))
                }}
              >
                <Input
                  aria-label={t('Recovery code')}
                  placeholder={t('Recovery code')}
                  value={code}
                  maxLength={80}
                  disabled={viewOnly}
                  onChange={(e) => setCode(e.target.value)}
                />
                <Dropdown
                  label={t('Where the backup is')}
                  value={codeSource}
                  options={[
                    { value: 'account', label: t('Ramu account') },
                    { value: 'github', label: t('My GitHub') },
                  ]}
                  onChange={(value) => setCodeSource(value as 'account' | 'github')}
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={viewOnly || busy || code.trim().length < 20}
                >
                  {t('Use the code')}
                </Button>
              </form>
            </div>
          ) : (
            <>
              <Button
                size="sm"
                variant="secondary"
                className="self-start"
                disabled={viewOnly || busy}
                onClick={() => void act(async () => setChoices(await invoke('account.restoreChoices')))}
              >
                {t('Find backups')}
              </Button>
              {choices && !choices.length && <SettingsEmpty>{t('No backups yet.')}</SettingsEmpty>}
              {choices && choices.length > 0 && (
                <SettingsCardList>
                  {choices.map((choice) => (
                    <SettingsCard
                      key={`${choice.source}:${choice.slot}`}
                      title={choice.name}
                      meta={`${choice.source === 'github' ? t('My GitHub') : t('Ramu account')} · ${when(choice.versions[0]?.createdAt ?? null)}`}
                      actions={
                        choice.kind === 'host' && choice.versions[0] ? (
                          <Dropdown
                            label={t('Restore')}
                            value=""
                            placeholder={t('Restore…')}
                            options={choice.versions.map((version, index) => ({
                              value: version.id,
                              label: index
                                ? t('Earlier: {time}', { time: when(version.createdAt) })
                                : t('Latest: {time}', { time: when(version.createdAt) }),
                            }))}
                            onChange={(version) =>
                              void act(async () => {
                                const file = await invoke('account.restoreFile', {
                                  source: choice.source,
                                  slot: choice.slot,
                                  version,
                                })
                                const preview = await invoke(
                                  'settingsTransfer.preview',
                                  file,
                                  defaultGroups(file).filter((group) => file.groups.includes(group)),
                                )
                                setRestore({ file, changes: preview.changes, from: choice.name })
                              })
                            }
                          />
                        ) : undefined
                      }
                    />
                  ))}
                </SettingsCardList>
              )}
            </>
          )}
        </>
      )}

      {signedIn && hasKey && requests.length > 0 && (
        <>
          <SettingsSectionHead
            title={t('New devices asking for your backup key')}
            help={t('Approve only when both screens show the same number.')}
          />
          <SettingsCardList>
            {requests.map((request) => (
              <SettingsCard
                key={request.id}
                title={request.name}
                meta={request.code ? t('It should show {code}', { code: request.code }) : t('Answer to see the number')}
                actions={
                  <>
                    {!request.code ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={viewOnly || busy}
                        onClick={() => void act(() => invoke('account.answerKeyRequest', request.id))}
                      >
                        {t('Answer')}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={viewOnly || busy}
                        onClick={() => void act(() => invoke('account.approveKeyRequest', request.id))}
                      >
                        {t('Approve')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={viewOnly || busy}
                      onClick={() => void act(() => invoke('account.denyKeyRequest', request.id))}
                    >
                      {t('Deny')}
                    </Button>
                  </>
                }
              />
            ))}
          </SettingsCardList>
        </>
      )}

      {signedIn && (
        <>
          <SettingsSectionHead
            title={t('Your hosts')}
            help={t(
              'A listed host can be added from your other devices signed in to this account, with no code. The account learns its name, never its address, and you can remove any device in Remote access.',
            )}
          />
          <label className="flex items-center gap-2 text-control">
            <Checkbox
              checked={status.listed}
              disabled={viewOnly || busy}
              onCheckedChange={(value) => void act(() => invoke('account.setListed', value === true))}
            />
            {t('List this host in my account')}
          </label>
          {status.listed && (
            <div className="flex flex-wrap items-center gap-2 text-control">
              <span>{t('When a device signed in to {0} asks', { 0: status.user?.email ?? '' })}</span>
              <Dropdown
                label={t('When a device signed in to {0} asks', { 0: status.user?.email ?? '' })}
                value={status.trust}
                disabled={viewOnly || busy}
                options={[
                  { value: 'owner', label: t('Connect it with full access') },
                  { value: 'viewer', label: t('Connect it with view-only access') },
                  { value: 'ask', label: t('Ask me here first') },
                ]}
                onChange={(value) => void act(() => invoke('account.setTrust', value as AccountTrust))}
              />
            </div>
          )}
          {hosts.length > 0 && (
            <SettingsCardList>
              {hosts.map((host) => (
                <SettingsCard
                  key={host.id}
                  title={host.name}
                  meta={
                    host.trust === 'ask'
                      ? t('Last seen {time} · asks before connecting', { time: when(host.lastSeen) })
                      : t('Last seen {time} · connects without asking', { time: when(host.lastSeen) })
                  }
                  actions={
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          setPairCode(null)
                          setPairingHost(host)
                          try {
                            await onThisComputer('computers.pairThroughAccount', host.id, host.name)
                          } finally {
                            setPairCode(null)
                            setPairingHost(null)
                          }
                        })
                      }
                    >
                      {host.trust === 'ask' ? t('Add this host') : t('Connect')}
                    </Button>
                  }
                />
              ))}
            </SettingsCardList>
          )}
          {pairCode && busy && (
            <p role="status" className="m-0 text-caption text-muted-foreground">
              {pairingHost && pairingHost.trust !== 'ask'
                ? t('Connecting to {0}…', { 0: pairingHost.name })
                : t('Allow this computer on the host when it shows {code}.', { code: pairCode })}
            </p>
          )}
        </>
      )}

      {recovery && <RecoveryCode code={recovery} onClose={() => setRecovery(null)} />}
      {restore && (
        <Dialog
          title={t('Restore settings from {0}', { 0: restore.from })}
          confirmLabel={t('Restore')}
          busy={busy}
          error={error}
          confirmDisabled={!restore.changes.length}
          onCancel={() => setRestore(null)}
          onConfirm={() =>
            void act(async () => {
              const groups = defaultGroups(restore.file).filter((group) => restore.file.groups.includes(group))
              await invoke('settingsTransfer.apply', restore.file, groups, restore.changes.length)
              setRestore(null)
            })
          }
        >
          {restore.changes.length ? (
            <ul className="m-0 max-h-72 overflow-auto pl-4 text-control">
              {restore.changes.map((change) => (
                <li key={`${change.group}:${change.label}`} className="break-all">
                  <strong>{change.label}</strong>: {change.before === null ? t('new') : change.before} → {change.after}
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0">{t('Nothing would change.')}</p>
          )}
        </Dialog>
      )}
      {deleting && (
        <Dialog
          title={t('Delete your Ramu account?')}
          confirmLabel={t('Delete account')}
          danger
          busy={busy}
          error={error}
          onCancel={() => setDeleting(false)}
          onConfirm={() => void act(() => invoke('account.delete')).then((ok) => ok && setDeleting(false))}
        >
          {t(
            'Every backup, listed host and sign-in in the account is deleted at once. Settings on your hosts stay as they are.',
          )}
        </Dialog>
      )}
    </section>
  )
}
