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
import { SettingsGroupTitle } from '@/components/settings-row'
import { Switch } from '@/components/ui/switch'
import { Dropdown } from '../Menu'

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
  const local = hostId === ownHostId()
  const refresh = useCallback(async () => {
    if (readOnly || access.current.readOnly || access.current.hostId !== hostId) return
    const status = await invokeOn(hostId, 'hostBrowser.status')
    if (access.current.readOnly || access.current.hostId !== hostId) return
    setStatus(status)
    if (local && status.enabled) {
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
      <SettingsGroupTitle>{t('Host browser')}</SettingsGroupTitle>
      <p className="text-caption text-muted-foreground">
        {t(
          'The browser runs on this host, like terminals. Paired owner devices can open it without extra access setup. Chromium is downloaded automatically on first use; website sign-ins stay on this host.',
        )}
      </p>
      {status?.reason && status.selected !== false && (
        <p role="status" className="text-caption">
          {t(status.reason)}
        </p>
      )}
      {error && (
        <p role="alert" className="text-caption">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Switch
          aria-label={t('Host browser')}
          checked={!!status?.enabled}
          disabled={busy || !local || !status}
          onCheckedChange={(enabled) =>
            void act(() => invokeOn(hostId, enabled ? 'hostBrowser.setup' : 'hostBrowser.disable'))
          }
        />
        {local &&
          status?.enabled &&
          !status.available &&
          status.reason !== 'The browser starts automatically when you open a tab.' && (
            <Button size="sm" disabled={busy} onClick={() => void act(() => invokeOn(hostId, 'hostBrowser.setup'))}>
              {t('Retry')}
            </Button>
          )}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act(async () => {})}>
          {t('Refresh')}
        </Button>
      </div>
      {local && status?.enabled && (
        <div className="flex flex-col gap-1">
          <Dropdown
            label={t('Browser engine')}
            value={status.engine ?? 'auto'}
            disabled={busy}
            options={[
              { value: 'auto', label: t('Automatic') },
              { value: 'chromium', label: t('Host Chromium') },
            ]}
            onChange={(value) =>
              void act(() => invokeOn(hostId, 'hostBrowser.setEngine', value === 'chromium' ? 'chromium' : 'auto'))
            }
          />
          <p className="text-caption text-muted-foreground">
            {t(
              'Automatic uses this computer’s own browser while Ramu is open, so pages run natively instead of being streamed, and falls back to Host Chromium when it is not. Host Chromium always runs the page on the host. Threads already running keep the browser they started with.',
            )}
          </p>
        </div>
      )}
      {local && status?.enabled && status.selected !== false && (
        <>
          <p className="text-caption text-muted-foreground">{t('Host browser profiles')}</p>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void act(async () => {
                await invokeOn(hostId, 'hostBrowser.profileCreate', name)
                setName('')
              })
            }}
          >
            <Input
              aria-label={t('Profile name')}
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
            <Button size="sm" disabled={busy || !name.trim()}>
              {t('Add profile')}
            </Button>
          </form>
          {profiles?.profiles
            .filter((profile) => !profile.temporary)
            .map((profile) => (
              <div key={profile.id} className="flex items-center gap-2 text-caption">
                <span className="flex-1">{profile.builtin ? t(profile.name) : profile.name}</span>
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
                  'This closes {0} tabs and signs out websites in this profile. Deleting a selected profile restores Default. This cannot be undone.',
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
