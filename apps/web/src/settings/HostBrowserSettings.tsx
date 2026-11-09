import { VIEW_ONLY_WRITE_NOTICE } from '../composer/viewerAccess'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserProfileCatalog } from '@ramu/shared/types/browser'
import type { RamuMethods } from '@ramu/shared/api'
import { invokeOn } from '../ipc'
import { ownHostId } from '../hosts'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Dropdown } from '../Menu'
import { BrowserImportPanel } from './BrowserImportPanel'
import { useStagedValue } from './stagedChanges'
import { accountKey } from '@ramu/shared/identities'
import { AccountIdentityPicker, IdentityDropdown, useAccountIdentities } from './AccountIdentity'

/** Runtime preferences and profile administration stay on the owning host. */
export function HostBrowserSettings({
  hostId,
  refreshed,
  onRemoved,
  readOnly = false,
}: {
  hostId: string
  readOnly?: boolean
  refreshed(): Promise<void>
  onRemoved(id: string): void
}) {
  const access = useRef({ hostId, readOnly })
  access.current = { hostId, readOnly }
  const allowed = () => access.current.hostId === hostId && !access.current.readOnly
  const [status, setStatus] = useState<ReturnType<RamuMethods['hostBrowser.status']> | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [profiles, setProfiles] = useState<BrowserProfileCatalog | null>(null)
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState('')
  const [rename, setRename] = useState('')
  const [review, setReview] = useState<ReturnType<RamuMethods['hostBrowser.profileReview']> | null>(null)
  const accountIdentities = useAccountIdentities()
  // Null follows the suggestion: the identity with no profile of its own yet, once one identity has one.
  const [chosenIdentity, setChosenIdentity] = useState<string | null>(null)
  const forIdentity = chosenIdentity ?? accountIdentities.suggestedFor('browser')
  const local = hostId === ownHostId()
  const refresh = useCallback(async () => {
    if (readOnly || access.current.readOnly || access.current.hostId !== hostId) return
    const status = await invokeOn(hostId, 'hostBrowser.status')
    if (access.current.readOnly || access.current.hostId !== hostId) return
    setStatus(status)
    if (local) {
      setProfiles(await invokeOn(hostId, 'hostBrowser.profiles'))
    }
  }, [hostId, local, readOnly])
  useEffect(() => {
    let active = true
    void refresh().catch((error) => {
      if (active) setError(t(errorText(error)))
    })
    return () => {
      active = false
    }
  }, [refresh])
  const [engine, stageEngine] = useStagedValue<string>('hostBrowser.engine', status?.engine ?? 'auto', (value) =>
    act(() => invokeOn(hostId, 'hostBrowser.setEngine', value === 'chromium' ? 'chromium' : 'auto')),
  )
  const act = async (work: () => Promise<unknown>) => {
    if (!allowed()) return
    setBusy(true)
    setError('')
    try {
      await work()
      await refresh()
      if (allowed()) await refreshed()
    } catch (error) {
      setError(t(errorText(error)))
    } finally {
      setBusy(false)
    }
  }
  if (readOnly)
    return (
      <p role="status" className="text-caption text-muted-foreground">
        {t(VIEW_ONLY_WRITE_NOTICE)}
      </p>
    )
  return (
    <div className="flex flex-col gap-3">
      <SettingsGroupTitle>{t('Which browser agents use')}</SettingsGroupTitle>
      {error && (
        <p role="alert" className="m-0 text-caption text-bad">
          {error}
        </p>
      )}
      {local && (
        <SettingsRow>
          <SettingsLabel
            title={t('Browser')}
            help={
              engine === 'chromium'
                ? t(
                    'Always this host’s own Chromium, so tabs and sign-ins are the same from the desktop, a phone or a remote thread.',
                  )
                : t(
                    'This app’s built-in browser while Ramu is open here, so pages run natively. Otherwise this host’s Chromium, which phones and remote threads use too.',
                  )
            }
          />
          <Dropdown
            label={t('Browser engine')}
            value={engine}
            disabled={busy}
            options={[
              { value: 'auto', label: t('Automatic') },
              { value: 'chromium', label: t('Host Chromium') },
            ]}
            onChange={stageEngine}
          />
        </SettingsRow>
      )}
      <SettingsRow>
        <SettingsLabel
          title={t('Host Chromium')}
          help={
            status?.available
              ? t(
                  'Running. Website sign-ins stay on this host. Stopping it closes its tabs; the next tab starts it again.',
                )
              : t(
                  status?.reason ||
                    'Starts by itself when a tab opens; it downloads once on first use. Website sign-ins stay on this host.',
                )
          }
        />
        <span className="flex items-center gap-2">
          {local && status && !status.available && status.reason && !status.reason.startsWith('The browser starts') && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void act(() => invokeOn(hostId, 'hostBrowser.setup'))}
            >
              {t('Retry')}
            </Button>
          )}
          {local && status?.available && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void act(() => invokeOn(hostId, 'hostBrowser.stop'))}
            >
              {t('Stop browser')}
            </Button>
          )}
        </span>
      </SettingsRow>
      {local && status?.selected !== false && (
        <>
          <SettingsGroupTitle className="mt-3">{t('Host browser profiles')}</SettingsGroupTitle>
          <p className="m-0 text-caption text-muted-foreground">
            {t('Each profile keeps its own website sign-ins. Threads pick one when they open a tab.')}
          </p>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void act(async () => {
                const profile = await invokeOn(hostId, 'hostBrowser.profileCreate', name)
                if (accountIdentities.identities && forIdentity)
                  await accountIdentities.assign(accountKey('browser', profile.id), forIdentity)
                setName('')
                setChosenIdentity(null)
              })
            }}
          >
            <Input
              aria-label={t('Profile name')}
              className="min-w-0 flex-1"
              placeholder={t('New profile, such as Work or Testing')}
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
            {accountIdentities.identities && (
              <IdentityDropdown
                identities={accountIdentities.identities}
                caption={t('For')}
                label={t('Which identity uses it')}
                value={forIdentity}
                onChange={setChosenIdentity}
              />
            )}
            <Button size="sm" disabled={busy || !name.trim()}>
              {t('Add profile')}
            </Button>
          </form>
          {profiles?.profiles
            .filter((profile) => !profile.temporary)
            .map((profile) => (
              <div key={profile.id} className="flex items-center gap-2 text-caption">
                <span className="flex-1">{profile.builtin ? t(profile.name) : profile.name}</span>
                <AccountIdentityPicker
                  accountKey={accountKey('browser', profile.id)}
                  name={profile.builtin ? t(profile.name) : profile.name}
                />
                {!profile.builtin &&
                  (renaming === profile.id ? (
                    <form
                      className="flex gap-1"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void act(async () => {
                          await invokeOn(hostId, 'hostBrowser.profileRename', profile.id, rename)
                          setRenaming('')
                        })
                      }}
                    >
                      <Input
                        aria-label={t('Profile name')}
                        maxLength={80}
                        value={rename}
                        onChange={(event) => setRename(event.target.value)}
                      />
                      <Button size="sm" disabled={busy || !rename.trim()}>
                        {t('Save')}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming('')}>
                        {t('Cancel')}
                      </Button>
                    </form>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setRenaming(profile.id)
                        setRename(profile.name)
                      }}
                    >
                      {t('Rename')}
                    </Button>
                  ))}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void act(async () =>
                      setReview(await invokeOn(hostId, 'hostBrowser.profileReview', profile.id, false)),
                    )
                  }
                >
                  {t('Clear website data')}
                </Button>
                {!profile.builtin && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void act(async () =>
                        setReview(await invokeOn(hostId, 'hostBrowser.profileReview', profile.id, true)),
                      )
                    }
                  >
                    {t('Delete profile')}
                  </Button>
                )}
              </div>
            ))}
          <BrowserImportPanel
            hostId={hostId}
            scope="host"
            existing={profiles?.profiles ?? []}
            busy={busy}
            onChanged={() => void act(async () => {})}
          />
        </>
      )}
      <Dialog
        open={!!review}
        onOpenChange={(open) => {
          if (!open) setReview(null)
        }}
      >
        <DialogContent className="max-h-[calc(100vh-48px)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{review?.remove ? t('Delete profile') : t('Clear website data')}</DialogTitle>
            <DialogDescription>
              {review &&
                t(
                  'Closes {0} tabs and signs out of websites in this profile. Deleting the selected profile switches back to Default. This cannot be undone.',
                  { 0: review.tabs },
                )}{' '}
              {review?.name}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => setReview(null)}>
              {t('Cancel')}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                review &&
                void act(async () => {
                  await invokeOn(hostId, 'hostBrowser.profileConfirm', review.token)
                  if (review.remove) onRemoved(review.id)
                  setReview(null)
                })
              }
            >
              {t('Confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
