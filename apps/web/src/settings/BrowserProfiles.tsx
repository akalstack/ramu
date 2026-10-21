import { useEffect, useRef, useState } from 'react'
import type { BrowserProfileCatalog, BrowserProfileInfo } from '@ramu/shared/types/browser'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SettingsGroupTitle } from '@/components/settings-row'
import { ramu } from '../ipc'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { addressFrom } from '../views/browserAddress'

/** Profile metadata and user-only sign-in. Site data and administration stay on this desktop. */
export function BrowserProfilesSettings({
  hostId,
  catalog,
  refresh,
  onRemoved,
}: {
  hostId: string
  catalog: BrowserProfileCatalog | null
  refresh(): Promise<void>
  onRemoved(id: string): void
}) {
  useLanguage()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signIn, setSignIn] = useState<BrowserProfileInfo | null>(null)
  const [address, setAddress] = useState('')
  const scope = useRef({ hostId, epoch: 0 })
  const acting = useRef(false)
  if (scope.current.hostId !== hostId) {
    scope.current = { hostId, epoch: scope.current.epoch + 1 }
    acting.current = false
  }
  useEffect(() => {
    setName('')
    setError(null)
    setSignIn(null)
    setBusy(false)
  }, [hostId])
  const run = async (operation: (valid: () => boolean) => Promise<void>) => {
    if (acting.current) return
    acting.current = true
    const epoch = scope.current.epoch
    const valid = () => scope.current.epoch === epoch && scope.current.hostId === hostId
    setBusy(true)
    setError(null)
    try {
      await operation(valid)
      if (valid()) await refresh()
    } catch (reason) {
      if (valid()) setError(t(errorText(reason)))
    } finally {
      if (valid()) {
        acting.current = false
        setBusy(false)
      }
    }
  }
  const create = () =>
    void run(async (valid) => {
      await ramu.invoke('browser.profiles.create', hostId, name)
      if (valid()) setName('')
    })
  return (
    <section className="mt-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <SettingsGroupTitle>{t('Browser profiles')}</SettingsGroupTitle>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void refresh()}>
          {t('Refresh')}
        </Button>
      </div>
      <p className="m-0 text-caption text-muted-foreground">
        {t(
          'Website sign-ins stay on this computer. Profiles share sign-ins across their tabs; Temporary stays separate for each run.',
        )}
      </p>
      {catalog?.error && (
        <p role="alert" className="m-0 text-caption text-bad">
          {t(catalog.error)}
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 text-caption text-bad">
          {error}
        </p>
      )}
      {catalog?.profiles.map((profile) => (
        <ProfileRow
          key={`${hostId}:${profile.id}`}
          profile={profile}
          busy={busy || !!catalog.error}
          onRename={(value) =>
            void run(async () => {
              await ramu.invoke('browser.profiles.rename', hostId, profile.id, value)
            })
          }
          onSignIn={() => {
            setSignIn(profile)
            setAddress('')
            setError(null)
          }}
          onClear={() =>
            void run(async () => {
              await ramu.invoke('browser.profiles.clear', hostId, profile.id)
            })
          }
          onDelete={() =>
            void run(async (valid) => {
              const result = await ramu.invoke('browser.profiles.delete', hostId, profile.id)
              if (!result.cancelled && valid()) onRemoved(profile.id)
            })
          }
        />
      ))}
      {catalog && !catalog.error && (
        <div className="flex items-center gap-2">
          <Input
            aria-label={t('New profile name')}
            value={name}
            maxLength={80}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (name.trim()) create()
              }
            }}
          />
          <Button type="button" variant="secondary" size="sm" disabled={busy || !name.trim()} onClick={create}>
            {t('Add profile')}
          </Button>
        </div>
      )}
      <Dialog
        open={!!signIn}
        onOpenChange={(open) => {
          if (!open && !busy) setSignIn(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Sign in to a website')}</DialogTitle>
            <DialogDescription>
              {t(
                'Enter the website to open in {0}. Sign in yourself in its browser window. Ramu does not read your password or copy sessions from another browser.',
                { 0: signIn?.name ?? '' },
              )}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="m-0 text-caption text-bad">
              {error}
            </p>
          )}
          <Input
            autoFocus
            aria-label={t('Website address')}
            placeholder="https://"
            value={address}
            disabled={busy}
            onChange={(event) => setAddress(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setSignIn(null)}>
              {t('Cancel')}
            </Button>
            <Button
              type="button"
              disabled={busy || !addressFrom(address)}
              onClick={() =>
                void run(async (valid) => {
                  const url = addressFrom(address)
                  if (!signIn || !url) return
                  await ramu.invoke('browser.profiles.signIn', hostId, signIn.id, url)
                  if (valid()) setSignIn(null)
                })
              }
            >
              {t('Open sign-in window')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function ProfileRow({
  profile,
  busy,
  onRename,
  onSignIn,
  onClear,
  onDelete,
}: {
  profile: BrowserProfileInfo
  busy: boolean
  onRename(name: string): void
  onSignIn(): void
  onClear(): void
  onDelete(): void
}) {
  const [name, setName] = useState(profile.name)
  useEffect(() => setName(profile.name), [profile.name])
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-(--radius-m) bg-fill p-3">
      <div className="min-w-0 flex-1">
        {profile.builtin ? (
          <span>{t(profile.name)}</span>
        ) : (
          <Input
            aria-label={t('Profile name')}
            value={name}
            maxLength={80}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        )}
        <p className="m-0 text-caption text-muted-foreground">
          {t('This computer')} · {t(profile.temporary ? 'Separate for each run' : 'Shared profile')}
        </p>
      </div>
      {!profile.builtin && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || !name.trim() || name.trim() === profile.name}
          onClick={() => onRename(name)}
        >
          {t('Save name')}
        </Button>
      )}
      {!profile.temporary && (
        <>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onSignIn}>
            {t('Sign in')}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClear}>
            {t('Clear website data')}
          </Button>
        </>
      )}
      {!profile.builtin && (
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onDelete}>
          {t('Delete profile')}
        </Button>
      )}
    </div>
  )
}
