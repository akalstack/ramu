import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Download, ExternalLink, UserRound } from 'lucide-react'
import type { AccountStatus, RestoreChoice } from '@ramu/shared/account'
import type { SettingsExport, TransferChange } from '@ramu/shared/settingsTransfer'
import { defaultGroups } from '@ramu/shared/settingsTransfer'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { LoadingDots } from '@/components/loading-dots'
import { SettingsAdvanced, SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Switch } from '@/components/ui/switch'
import { Dialog, Dropdown } from '../Menu'
import { useViewOnly } from '../composer/useViewOnly'
import { t, useLanguage } from '../i18n'
import { copyText, invoke as onThisComputer } from '../ipc'
import { errorText } from '../lib/errors'
import { AccountProfileHeader } from './AccountProfile'
import { SETTINGS_CARD, SettingsCard, SettingsCardList, SettingsEmpty, SettingsSectionHead } from './cards'
import { useSettingsEvents, useSettingsInvoke } from './SettingsScope'

const when = (time: number | null) => (time ? new Date(time).toLocaleString() : t('never'))
const openSection = (section: string) => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section } }))

/** What the account adds, said where someone decides whether to sign in. */
const BENEFITS = [
  'Back up settings so only your devices can open them',
  'Your phone and other computers connect to your hosts without a code',
  'A free Ramu Link address that reaches this host from anywhere',
]

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

/** Signed out: what the account is for, and one way in. */
function SignInCard({ busy, disabled, onSignIn }: { busy: boolean; disabled: boolean; onSignIn: () => void }) {
  return (
    <article className={`${SETTINGS_CARD} gap-3! px-4! py-4!`}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 flex-none items-center justify-center rounded-full bg-fill text-muted-foreground"
        >
          <UserRound size={20} />
        </span>
        <div className="min-w-0">
          <strong className="block text-control font-medium">{t('Sign in to Ramu')}</strong>
          <span className="text-caption text-muted-foreground">
            {t('Optional, and free. Sign in with GitHub, Google or a passkey.')}
          </span>
        </div>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-control">
        {BENEFITS.map((benefit) => (
          <li key={benefit} className="flex items-start gap-2">
            <Check size={14} className="mt-0.5 flex-none text-(--accent)" aria-hidden />
            {t(benefit)}
          </li>
        ))}
      </ul>
      <Button variant="default" className="self-start" disabled={disabled || busy} onClick={onSignIn}>
        {t('Sign in')}
      </Button>
    </article>
  )
}

/** A sign-in waiting for the browser: the code to compare, the page to open, and that Ramu is waiting. */
function PendingSignIn({
  pending,
  onCancel,
}: {
  pending: NonNullable<AccountStatus['pendingSignIn']>
  onCancel: () => void
}) {
  return (
    <article className={`${SETTINGS_CARD} gap-3! px-4! py-4!`} aria-live="polite">
      <div className="flex flex-col gap-1">
        <strong className="text-control font-medium">{t('Finish signing in in your browser')}</strong>
        <span className="text-caption text-muted-foreground">
          {t('Sign in with GitHub, Google or a passkey, check the code matches and choose Approve.')}
        </span>
      </div>
      <code className="self-start rounded-(--radius-s) bg-fill px-3 py-1.5 font-mono text-[17px] tracking-[0.2em]">
        {pending.userCode}
      </code>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="default"
          onClick={() => void onThisComputer('app.openExternal', pending.verificationUri)}
        >
          <ExternalLink size={13} />
          {t('Open the sign-in page')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('Cancel')}
        </Button>
        <span className="flex items-center gap-1.5 text-caption text-muted-foreground" role="status">
          <LoadingDots />
          {t('Waiting for you to approve…')}
        </span>
      </div>
    </article>
  )
}

/** Where this host stands for the account's other devices; the setting itself is with the others in Devices & access. */
function HostOnAccount({ status }: { status: AccountStatus }) {
  const summary = !status.listed
    ? t('Not listed. Your other devices pair with a code.')
    : status.trust === 'ask'
      ? t('Listed. Devices on your account ask here before they connect.')
      : status.trust === 'viewer'
        ? t('Listed. Devices on your account connect with view-only access.')
        : t('Listed. Devices on your account connect with full access.')
  return (
    <SettingsRow>
      <SettingsLabel title={t('This host on your account')} help={summary} />
      <Button variant="secondary" size="sm" onClick={() => openSection('remote')}>
        {t('Change in Devices & access')}
      </Button>
    </SettingsRow>
  )
}

/**
 * Restore in one dialog: first the backup key (another device approves, or the recovery code), then the backups found,
 * each opening a preview before anything changes.
 */
function RestoreDialog({
  status,
  busy,
  error,
  act,
  onPick,
  onClose,
}: {
  status: AccountStatus
  busy: boolean
  error: string | null
  act: (run: () => Promise<unknown>) => Promise<boolean>
  onPick: (choice: RestoreChoice, version: string) => void
  onClose: () => void
}) {
  const invoke = useSettingsInvoke()
  const viewOnly = useViewOnly()
  const signedIn = status.signedIn
  const hasKey = status.backup.hasKey
  const [code, setCode] = useState('')
  const [codeSource, setCodeSource] = useState<'account' | 'github'>('account')
  const [asking, setAsking] = useState<{ code: string | null; done: boolean; error: string | null } | null>(null)
  const [choices, setChoices] = useState<RestoreChoice[] | null>(null)
  const recoverFrom = signedIn ? codeSource : 'github'
  // While a key request is open, follow it; once the key is here the backups are read.
  useEffect(() => {
    if (hasKey || !signedIn) return
    const read = () => void invoke('account.keyRequestState').then(setAsking, () => {})
    read()
    const timer = setInterval(read, 3000)
    return () => clearInterval(timer)
  }, [invoke, hasKey, signedIn])
  useEffect(() => {
    if (hasKey) void invoke('account.restoreChoices').then(setChoices, () => setChoices([]))
  }, [invoke, hasKey])
  return (
    <Dialog
      title={t('Restore settings')}
      confirmLabel={t('Done')}
      cancellable={false}
      error={error}
      onConfirm={onClose}
      onCancel={onClose}
    >
      <div className="flex flex-col gap-3 text-control">
        {!hasKey ? (
          <>
            <p className="m-0 text-muted-foreground">
              {t('Backups are sealed with a key only your devices hold. Get it onto this host first.')}
            </p>
            {signedIn && (
              <div className="flex flex-col gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  className="self-start"
                  disabled={viewOnly || busy || !!asking}
                  onClick={() => void act(() => invoke('account.requestKey'))}
                >
                  {t('Approve on another device')}
                </Button>
                {asking && (
                  <span className="text-caption text-muted-foreground" role="status">
                    {asking.error ??
                      (asking.code
                        ? t('Check that your other device shows {code}, then approve there.', { code: asking.code })
                        : t('Open Settings → Account on a device you have.'))}
                  </span>
                )}
              </div>
            )}
            <form
              className="flex flex-col gap-1.5"
              onSubmit={(event) => {
                event.preventDefault()
                void act(() => invoke('account.useRecoveryCode', code, recoverFrom)).then((ok) => ok && setCode(''))
              }}
            >
              <span className="text-caption text-muted-foreground">
                {signedIn ? t('Or use your recovery code') : t('Use your recovery code')}
              </span>
              <div className="flex items-center gap-1.5">
                <Input
                  aria-label={t('Recovery code')}
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  value={code}
                  maxLength={80}
                  disabled={viewOnly}
                  onChange={(e) => setCode(e.target.value)}
                />
                {signedIn && (
                  <Dropdown
                    label={t('Where the backup is')}
                    value={recoverFrom}
                    options={[
                      { value: 'account', label: t('Ramu account') },
                      { value: 'github', label: t('My GitHub') },
                    ]}
                    onChange={(value) => setCodeSource(value as 'account' | 'github')}
                  />
                )}
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={viewOnly || busy || code.trim().length < 20}
                >
                  {t('Use the code')}
                </Button>
              </div>
            </form>
          </>
        ) : choices === null ? (
          <span className="flex items-center gap-1.5 text-muted-foreground" role="status">
            <LoadingDots />
            {t('Finding backups…')}
          </span>
        ) : !choices.length ? (
          <SettingsEmpty>{t('No backups yet.')}</SettingsEmpty>
        ) : (
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
                      onChange={(version) => onPick(choice, version)}
                    />
                  ) : undefined
                }
              />
            ))}
          </SettingsCardList>
        )}
      </div>
    </Dialog>
  )
}

/**
 * Settings › Account: the optional Ramu account and settings backups. Who is signed in comes first, then backups and
 * restore; rare and destructive actions wait under Advanced. Whether the account's devices may connect to this host is
 * set in Devices & access with the other ways in, and the hosts listed on the account are under Hosts you use there.
 */
export function AccountSettings() {
  useLanguage()
  const invoke = useSettingsInvoke()
  const on = useSettingsEvents()
  const viewOnly = useViewOnly()
  const [status, setStatus] = useState<AccountStatus | null>(null)
  const [recovery, setRecovery] = useState<string | null>(null)
  const [requests, setRequests] = useState<{ id: string; name: string; code: string | null; expiresAt: number }[]>([])
  const [restoring, setRestoring] = useState(false)
  const [restore, setRestore] = useState<{ file: SettingsExport; changes: TransferChange[]; from: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  // What a switch was just set to, shown until the host answers so the click is never lost.
  const [choosing, setChoosing] = useState<{ account?: boolean; github?: boolean }>({})
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(
    () => invoke('account.status').then(setStatus, (cause) => setError(errorText(cause))),
    [invoke],
  )
  useEffect(() => {
    void reload()
    return on('account:changed', () => void reload())
  }, [on, reload])
  const signedIn = !!status?.signedIn
  const hasKey = !!status?.backup.hasKey
  // While the page is open: new devices asking for the backup key.
  useEffect(() => {
    if (!signedIn || !hasKey) return
    const read = () => void invoke('account.keyRequests').then(setRequests, () => {})
    read()
    const timer = setInterval(read, 3000)
    return () => clearInterval(timer)
  }, [invoke, signedIn, hasKey])
  const act = async (run: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await run()
      await reload()
      return true
    } catch (cause) {
      setError(errorText(cause))
      return false
    } finally {
      setBusy(false)
    }
  }
  const setBackup = (destination: 'account' | 'github', value: boolean) => {
    setChoosing((current) => ({ ...current, [destination]: value }))
    void act(async () => {
      const result = await invoke('account.setBackup', { [destination]: value })
      if (result.recoveryCode) setRecovery(result.recoveryCode)
    }).finally(() => setChoosing((current) => ({ ...current, [destination]: undefined })))
  }
  // Turned on while signed out: sign in first, then back up once the account answers.
  const [backupAfterSignIn, setBackupAfterSignIn] = useState(false)
  const backedUpToAccount = !!status?.backup.account
  useEffect(() => {
    if (!backupAfterSignIn || !signedIn) return
    setBackupAfterSignIn(false)
    if (backedUpToAccount) return
    void invoke('account.setBackup', { account: true }).then(
      (result) => {
        if (result.recoveryCode) setRecovery(result.recoveryCode)
        return reload()
      },
      (cause) => setError(errorText(cause)),
    )
  }, [backupAfterSignIn, signedIn, backedUpToAccount, invoke, reload])
  if (!status) return error ? <p className="text-bad">{error}</p> : null
  const pending = status.pendingSignIn
  const backingUp = status.backup.account || status.backup.github
  const signIn = () => void act(() => invoke('account.signIn'))
  const pickBackup = (choice: RestoreChoice, version: string) =>
    void act(async () => {
      const file = await invoke('account.restoreFile', { source: choice.source, slot: choice.slot, version })
      const preview = await invoke(
        'settingsTransfer.preview',
        file,
        defaultGroups(file).filter((group) => file.groups.includes(group)),
      )
      setRestoring(false)
      setRestore({ file, changes: preview.changes, from: choice.name })
    })

  return (
    <section className="flex flex-col gap-2" aria-label={t('Ramu account')}>
      <SettingsSectionHead
        title={t('Ramu account')}
        help={t(
          'Run by Akalstack. Backups are sealed on this host before they leave it, so only your devices can open them.',
        )}
      />
      {error && !restoring && (
        <p role="alert" className="m-0 text-caption text-bad">
          {error}
        </p>
      )}

      {requests.length > 0 && (
        <SettingsCardList>
          {requests.map((request) => (
            <SettingsCard
              key={request.id}
              className="ring-1 ring-(--accent)/40"
              title={t('{0} is asking for your backup key', { 0: request.name })}
              meta={
                request.code
                  ? t('Approve only if it shows {code}.', { code: request.code })
                  : t('Answer to see the number both screens should show.')
              }
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
      )}

      {pending ? (
        <PendingSignIn pending={pending} onCancel={() => void act(() => invoke('account.cancelSignIn'))} />
      ) : signedIn && status.user ? (
        <>
          <article className={`${SETTINGS_CARD} flex-row! items-center gap-3 py-3`}>
            <AccountProfileHeader user={status.user} providers={status.providers} />
            <Button
              size="sm"
              variant="ghost"
              className="flex-none"
              disabled={viewOnly || busy}
              onClick={() => void act(() => invoke('account.signOut'))}
            >
              {t('Sign out')}
            </Button>
          </article>
          <div className="mt-2">
            <HostOnAccount status={status} />
          </div>
        </>
      ) : (
        <SignInCard busy={busy} disabled={viewOnly} onSignIn={signIn} />
      )}

      <SettingsGroupTitle className="mt-3">{t('Back up settings')}</SettingsGroupTitle>
      <div>
        <SettingsRow className="settings-toggle">
          <SettingsLabel
            title={t('To your Ramu account')}
            help={
              signedIn
                ? t('The last 30 versions.')
                : backupAfterSignIn
                  ? t('Finish signing in above. The backup turns on once you are signed in.')
                  : t('Turning it on starts sign-in.')
            }
          />
          <Switch
            aria-label={t('To your Ramu account')}
            checked={choosing.account ?? (status.backup.account || backupAfterSignIn)}
            disabled={viewOnly || busy}
            onCheckedChange={(value) => {
              if (signedIn) return setBackup('account', value)
              if (!value) return setBackupAfterSignIn(false)
              setBackupAfterSignIn(true)
              if (!pending) signIn()
            }}
          />
        </SettingsRow>
        <SettingsRow className="settings-toggle">
          <SettingsLabel
            title={t('To a private gist on your GitHub')}
            help={t('No Ramu account needed. Uses the GitHub account signed in on this host.')}
          />
          <Switch
            aria-label={t('To a private gist on your GitHub')}
            checked={choosing.github ?? status.backup.github}
            disabled={viewOnly || busy}
            onCheckedChange={(value) => setBackup('github', value)}
          />
        </SettingsRow>
        {backingUp && (
          <SettingsRow>
            <SettingsLabel
              title={status.backup.error ? t('The last backup failed') : t('Backed up')}
              help={
                status.backup.error
                  ? status.backup.error
                  : t('Last backup: {time}. Theme, models, rules, commit style and identities; never credentials.', {
                      time: when(status.backup.lastBackupAt),
                    })
              }
            />
            {hasKey && (
              <Button
                size="sm"
                variant="secondary"
                disabled={viewOnly || busy}
                onClick={() => void act(() => invoke('account.backupNow'))}
              >
                {t('Back up now')}
              </Button>
            )}
          </SettingsRow>
        )}
      </div>

      {(signedIn || status.backup.github) && (
        <SettingsRow>
          <SettingsLabel
            title={t('Restore settings')}
            help={t('From a backup this or another of your hosts made. Nothing changes until you review it.')}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={viewOnly || busy}
            onClick={() => {
              setError(null)
              setRestoring(true)
            }}
          >
            {t('Restore…')}
          </Button>
        </SettingsRow>
      )}

      {(hasKey || signedIn) && (
        <SettingsAdvanced className="mt-0">
          {hasKey && (
            <SettingsRow>
              <SettingsLabel
                title={t('Recovery code')}
                help={t(
                  'Opens your backups on a new machine when no other device is around. A new one replaces the old.',
                )}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={viewOnly || busy}
                onClick={() => void act(async () => setRecovery(await invoke('account.newRecoveryCode')))}
              >
                {t('New recovery code')}
              </Button>
            </SettingsRow>
          )}
          {status.backup.account && (
            <SettingsRow>
              <SettingsLabel
                title={t('Backups in the account')}
                help={t('Deletes every version kept in the Ramu account. Backups on GitHub stay.')}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={viewOnly || busy}
                onClick={() => void act(() => invoke('account.deleteBackups', 'account'))}
              >
                {t('Delete backups in the account')}
              </Button>
            </SettingsRow>
          )}
          {signedIn && (
            <SettingsRow>
              <SettingsLabel
                title={t('Delete account')}
                help={t('Deletes every backup, listed host and sign-in in the account. Settings on your hosts stay.')}
              />
              <Button
                size="sm"
                variant="secondary"
                className="text-bad"
                disabled={viewOnly || busy}
                onClick={() => setDeleting(true)}
              >
                {t('Delete account…')}
              </Button>
            </SettingsRow>
          )}
        </SettingsAdvanced>
      )}

      {restoring && (
        <RestoreDialog
          status={status}
          busy={busy}
          error={error}
          act={act}
          onPick={pickBackup}
          onClose={() => setRestoring(false)}
        />
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
