import { useEffect, useRef, useState } from 'react'
import type { ArtifactInfo } from '@ramu/shared/artifacts'
import { Button } from '../components/desktop-button'
import { Input } from '../components/desktop-input'
import { Dialog } from '../Menu'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { useHost } from '../workspace/HostProvider'
import { drawAppIcon, squarePicture } from './artifactApp'

/**
 * The picture the artifact's installed app shows: one the person picks, one the host's image generation makes from
 * the artifact's name or a few words, or the artifact's emoji. Nothing changes until Save.
 */
export function AppIconDialog({ page, onClose }: { page: ArtifactInfo; onClose(): void }) {
  useLanguage()
  const { invoke } = useHost()
  // Undefined while the current picture is read; null is the emoji.
  const [picture, setPicture] = useState<string | null | undefined>(page.appIcon ? undefined : null)
  const [original, setOriginal] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [idea, setIdea] = useState('')
  const [busy, setBusy] = useState<'generate' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!page.appIcon) return
    let current = true
    void invoke('artifacts.appIcon', page.id)
      .then((saved) => {
        if (!current) return
        setOriginal(saved)
        setPicture(saved)
      })
      .catch(() => current && setPicture(null))
    return () => {
      current = false
    }
  }, [invoke, page.id, page.appIcon])

  useEffect(() => {
    if (picture === undefined) return
    let current = true
    void drawAppIcon(page.icon, picture)
      .then((drawn) => current && setPreview(drawn))
      .catch((e) => current && setError(errorText(e)))
    return () => {
      current = false
    }
  }, [page.icon, picture])

  const generate = () => {
    setBusy('generate')
    setError(null)
    void invoke('artifacts.generateAppIcon', page.id, idea.trim() || undefined)
      .then(setPicture)
      .catch((e) => setError(errorText(e)))
      .finally(() => setBusy(null))
  }

  return (
    <Dialog
      title={t('App icon')}
      confirmLabel={t('Save')}
      confirmDisabled={picture === undefined || picture === original || busy !== null}
      busy={busy === 'save'}
      error={error}
      onCancel={onClose}
      onConfirm={() => {
        if (picture === undefined) return
        setBusy('save')
        setError(null)
        void invoke('artifacts.setAppIcon', page.id, picture)
          .then(onClose)
          .catch((e) => setError(errorText(e)))
          .finally(() => setBusy(null))
      }}
    >
      <div className="flex items-start gap-4">
        <div className="size-24 flex-none">
          {preview ? <img src={preview} alt={t('App icon preview')} className="size-24" /> : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="m-0 text-caption text-muted-foreground">
            {t('Shown where this artifact is installed as an app. Pictures are cropped to a square.')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => fileInput.current?.click()}>
              {t('Choose picture…')}
            </Button>
            {picture ? (
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setPicture(null)}>
                {t('Use emoji {0}', { 0: page.icon })}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <form
        className="mt-3 flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (busy === null) generate()
        }}
      >
        <Input
          aria-label={t('What the icon should show')}
          placeholder={t('What it should show (optional)')}
          value={idea}
          maxLength={500}
          onChange={(event) => setIdea(event.target.value)}
        />
        <Button type="submit" size="sm" variant="secondary" disabled={busy !== null}>
          {busy === 'generate' ? t('Making…') : t('Make with AI')}
        </Button>
      </form>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          setError(null)
          void squarePicture(file)
            .then(setPicture)
            .catch((e) => setError(errorText(e)))
        }}
      />
    </Dialog>
  )
}
