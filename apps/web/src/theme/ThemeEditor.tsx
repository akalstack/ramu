import { LocalInlineAction } from '@/components/inline-action'
import { ThemeRecoveryButton } from '@/components/theme-recovery-button'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import {
  THEME_FILE_EXTENSION,
  checkTheme,
  DEFAULT_THEME,
  exportThemeFile,
  themeDigest,
  themeCssVariables,
  type RamuTheme,
  type ThemeRole,
} from '@ramu/shared/theme'
import { NO_LOCKED_ROLES, themeRecipe, type LockedRoles } from '@ramu/shared/themeGeneration'
import { invoke } from '../ipc'
import { errorText } from '../lib/errors'
import { notifyError } from '../chat/Notifications'
import { ThemePreview } from './ThemePreview'
import { t } from '../i18n'
import { resolvedAppearance } from '../appearance'
import { effectiveTheme, endTrial, keepTheme, startTrial } from './themes'

const MAX_REFERENCES = 3

const GROUPS: { title: string; roles: { role: ThemeRole; label: string }[] }[] = [
  {
    title: 'Surfaces',
    roles: [
      { role: 'window', label: 'Window and sidebar' },
      { role: 'canvas', label: 'Main surface' },
      { role: 'raised', label: 'Raised surface' },
      { role: 'subtle', label: 'Quiet fill' },
      { role: 'bubble', label: 'Your messages' },
      { role: 'codeBackground', label: 'Code and terminal' },
    ],
  },
  {
    title: 'Text',
    roles: [
      { role: 'text', label: 'Headings' },
      { role: 'textBody', label: 'Body text' },
      { role: 'soft', label: 'Secondary text' },
      { role: 'muted', label: 'Muted text' },
      { role: 'placeholder', label: 'Placeholder' },
    ],
  },
  {
    title: 'Actions',
    roles: [
      { role: 'primary', label: 'Primary action' },
      { role: 'primaryHover', label: 'Primary hover' },
      { role: 'primaryInk', label: 'Text on primary' },
      { role: 'accent', label: 'Links and highlights' },
    ],
  },
  {
    title: 'Status',
    roles: [
      { role: 'ok', label: 'Success' },
      { role: 'warn', label: 'Warning' },
      { role: 'bad', label: 'Error' },
    ],
  },
]

type Variant = 'light' | 'dark'

const MAX_DIRECTIONS = 3

export async function shareTheme(theme: RamuTheme, how: 'download' | 'copy') {
  try {
    const text = await exportThemeFile(theme)
    if (how === 'copy') return await navigator.clipboard.writeText(text)
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${theme.id}${THEME_FILE_EXTENSION}`
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    notifyError(error instanceof Error ? error.message : String(error), 'Theme')
  }
}

function ColorField({
  label,
  value,
  original,
  onChange,
}: {
  label: string
  value: string
  original: string
  onChange: (value: string) => void
}) {
  // An unfinished hex entry stays in the field; only a complete color reaches the draft.
  const [text, setText] = useState<string | null>(null)
  return (
    <div className="flex items-center gap-2 min-h-8">
      <input
        type="color"
        aria-label={t(label)}
        value={value}
        onChange={(event) => {
          setText(null)
          onChange(event.target.value)
        }}
        className="size-6 shrink-0 cursor-pointer p-0 rounded-(--radius-xs)"
      />
      <span className="flex-1 min-w-0 truncate">{t(label)}</span>
      <Input
        aria-label={`${t(label)} (hex)`}
        value={text ?? value}
        maxLength={7}
        spellCheck={false}
        className="w-24 font-mono"
        onChange={(event) => {
          const next = event.target.value.toLowerCase()
          setText(next)
          if (/^#[0-9a-f]{6}$/.test(next)) {
            onChange(next)
            setText(null)
          }
        }}
        onBlur={() => setText(null)}
      />
      <Button
        variant="ghost"
        size="sm"
        disabled={value === original}
        onClick={() => {
          setText(null)
          onChange(original)
        }}
      >
        {t('Reset')}
      </Button>
    </div>
  )
}

/** Edits a copy of the selected theme. The app itself is the preview: the draft is applied as a trial until it is kept. */
export function ThemeEditor({
  onClose,
  imported,
  notice,
}: {
  onClose: () => void
  /** A theme opened from a file: tried first, kept only on request, and left untouched until edited. */
  imported?: RamuTheme
  notice?: string
}) {
  const base = useMemo(() => imported ?? effectiveTheme(), [imported])
  const [draft, setDraft] = useState<RamuTheme>(() =>
    base.id === DEFAULT_THEME.id ? { ...base, id: `my-theme-${Date.now().toString(36)}`, name: t('My theme') } : base,
  )
  const [history, setHistory] = useState<{ past: RamuTheme[]; future: RamuTheme[] }>({ past: [], future: [] })
  const [variant, setVariant] = useState<Variant>(resolvedAppearance())
  const issues = useMemo(() => checkTheme(draft), [draft])
  // Colors set by hand stay as they are when the AI refines the rest, until the locks are released.
  const [locked, setLocked] = useState<LockedRoles>(NO_LOCKED_ROLES)
  const [brief, setBrief] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState<string | null>(null)
  const generation = useRef(0)
  // Up to three pictures the model looks at for mood and palette. They are sent only with a request, never stored in the theme.
  const [references, setReferences] = useState<{ id: string; name: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const referencePicker = useRef<HTMLInputElement>(null)
  // Directions tried for the current wish; a few is enough to compare, and Undo steps back between them.
  const [directions, setDirections] = useState(0)
  const [candidates, setCandidates] = useState<RamuTheme[]>([])
  useEffect(() => {
    if (imported) startTrial(imported)
  }, [imported])

  const commit = (next: RamuTheme, record = true) => {
    if (record) setHistory(({ past }) => ({ past: [...past, draft].slice(-50), future: [] }))
    setDraft(next)
    startTrial(next)
  }
  const addReferences = async (files: File[]) => {
    setUploading(true)
    try {
      const room = MAX_REFERENCES - references.length
      const added = await Promise.all(
        files
          .filter((file) => file.type.startsWith('image/'))
          .slice(0, room)
          .map(async (file) => {
            if (!file.size || file.size > 10 * 1024 * 1024)
              throw new Error(`${file.name}: ${t('Images must be nonempty and no larger than 10 MB.')}`)
            const encoded = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(String(reader.result).split(',')[1]!)
              reader.onerror = () => reject(new Error(file.name))
              reader.readAsDataURL(file)
            })
            const attachment = await invoke('attachments.add', file.name, encoded)
            return { id: attachment.id, name: file.name }
          }),
      )
      setReferences((current) => [...current, ...added].slice(0, MAX_REFERENCES))
    } catch (error) {
      notifyError(errorText(error), t('Reference image'))
    } finally {
      setUploading(false)
    }
  }
  const generate = async (feedback?: string) => {
    const mine = ++generation.current
    setGenerating(true)
    try {
      const result = await invoke(
        'theme.generate',
        brief.trim(),
        draft,
        locked,
        feedback,
        references.map((reference) => reference.id),
      )
      if (mine !== generation.current) return
      // The result keeps this draft's identity, so Undo returns to the previous colors and Keep updates one theme.
      commit({ ...result.theme, id: draft.id, name: draft.name === t('My theme') ? result.theme.name : draft.name })
      setGenerated(`${result.provider} · ${result.model}`)
      setDirections((count) => (feedback ? count + 1 : 1))
    } catch (error) {
      if (mine === generation.current) notifyError(errorText(error), t('Create with AI'))
    } finally {
      if (mine === generation.current) setGenerating(false)
    }
  }
  const compare = async () => {
    const mine = ++generation.current
    setGenerating(true)
    try {
      const results = await invoke(
        'theme.candidates',
        brief.trim(),
        draft,
        locked,
        references.map((reference) => reference.id),
      )
      if (mine !== generation.current) return
      if (!results.length) throw new Error(t('No usable themes came back. Try again or change your description.'))
      setCandidates(results.map((result) => result.theme))
      setGenerated(`${results[0]!.provider} · ${results[0]!.model}`)
    } catch (error) {
      if (mine === generation.current) notifyError(errorText(error), t('Create with AI'))
    } finally {
      if (mine === generation.current) setGenerating(false)
    }
  }
  const revert = () => {
    generation.current++
    endTrial()
    onClose()
  }
  const keep = () => {
    if (!keepTheme(draft).length) onClose()
  }
  const step = (from: 'past' | 'future') => {
    const target = history[from].at(-1)
    if (!target) return
    const to = from === 'past' ? 'future' : 'past'
    setHistory({ ...history, [from]: history[from].slice(0, -1), [to]: [...history[to], draft] })
    setDraft(target)
    startTrial(target)
  }
  const original = base.id === DEFAULT_THEME.id ? DEFAULT_THEME : base

  return (
    <Dialog open onOpenChange={(open) => !open && revert()}>
      <DialogContent
        className="w-[min(560px,calc(100vw-40px))] sm:max-w-none max-h-[calc(100vh-40px)] flex flex-col gap-3 overflow-hidden"
        aria-describedby={undefined}
        showCloseButton={false}
        // The editor keeps Ramu Default's colors, so it stays readable however the draft looks.
        style={themeCssVariables(DEFAULT_THEME[resolvedAppearance()])}
      >
        <DialogTitle>{t('Customize colors')}</DialogTitle>
        <div className="flex items-center gap-2">
          <Input
            aria-label={t('Theme name')}
            value={draft.name}
            maxLength={80}
            onChange={(event) => commit({ ...draft, name: event.target.value }, false)}
            className="flex-1"
          />
          {(['light', 'dark'] as const).map((name) => (
            <Button key={name} variant="secondary" aria-pressed={variant === name} onClick={() => setVariant(name)}>
              {name === 'light' ? t('Light') : t('Dark')}
            </Button>
          ))}
          <Button variant="ghost" disabled={!history.past.length} onClick={() => step('past')}>
            {t('Undo')}
          </Button>
          <Button variant="ghost" disabled={!history.future.length} onClick={() => step('future')}>
            {t('Redo')}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Input
            aria-label={t('Describe the theme or a change')}
            placeholder={t('e.g. warmer and easier on the eyes')}
            value={brief}
            maxLength={2000}
            onChange={(event) => {
              setBrief(event.target.value)
              setDirections(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && brief.trim() && !generating) void generate()
            }}
            className="flex-1"
          />
          <Button variant="secondary" disabled={!brief.trim() || generating} onClick={() => void generate()}>
            {generating ? t('Creating…') : t('Create with AI')}
          </Button>
          <Button variant="ghost" disabled={!brief.trim() || generating} onClick={() => void compare()}>
            {t('Compare 3')}
          </Button>
          {directions > 0 && directions < MAX_DIRECTIONS && (
            <Button
              variant="ghost"
              disabled={generating}
              onClick={() =>
                void generate('Give a clearly different direction from the current draft, keeping the same wish.')
              }
            >
              {t('Another direction')}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={referencePicker}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={(event) => {
              const files = [...(event.target.files ?? [])]
              event.target.value = ''
              if (files.length) void addReferences(files)
            }}
          />
          <Button
            variant="ghost"
            disabled={uploading || generating || references.length >= MAX_REFERENCES}
            onClick={() => referencePicker.current?.click()}
          >
            {uploading ? t('Adding…') : t('Add reference image')}
          </Button>
          {references.map((reference) => (
            <span key={reference.id} className="inline-flex items-center gap-1 text-caption text-muted-foreground">
              <span className="max-w-[160px] truncate">{reference.name}</span>
              <LocalInlineAction
                tone="muted"
                aria-label={`${t('Remove reference image')} ${reference.name}`}
                onClick={() => setReferences((current) => current.filter((entry) => entry.id !== reference.id))}
              >
                {t('Remove')}
              </LocalInlineAction>
            </span>
          ))}
          {references.length > 0 && (
            <span className="text-caption text-muted-foreground">
              {t('Reference images are sent to the host’s provider with your next request.')}
            </span>
          )}
        </div>
        {(generated || locked.light.length + locked.dark.length > 0) && (
          <p className="m-0 text-caption text-muted-foreground">
            {generated && `${t('Drafted with')} ${generated}. ${t('This counts toward that provider’s usage.')} `}
            {locked.light.length + locked.dark.length > 0 && `${t('Colors you set by hand stay as they are.')} `}
            {locked.light.length + locked.dark.length > 0 && (
              <LocalInlineAction tone="muted" onClick={() => setLocked(NO_LOCKED_ROLES)}>
                {t('Let AI change them')}
              </LocalInlineAction>
            )}
          </p>
        )}
        {candidates.length > 0 && (
          <div className="flex gap-2" role="group" aria-label={t('Candidates')}>
            {candidates.map((candidate, index) => (
              <div key={candidate.id} className="flex-1 min-w-0 flex flex-col gap-1">
                <ThemePreview variant={candidate[variant]} appearance={variant} compact />
                <Button
                  variant="secondary"
                  onClick={() => {
                    commit({
                      ...candidate,
                      id: draft.id,
                      name: draft.name === t('My theme') ? candidate.name : draft.name,
                    })
                    setCandidates([])
                  }}
                >
                  {`${t('Use')} ${index + 1}`}
                </Button>
              </div>
            ))}
            <Button variant="ghost" onClick={() => setCandidates([])}>
              {t('Dismiss')}
            </Button>
          </div>
        )}
        <ThemePreview variant={draft[variant]} appearance={variant} />
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {GROUPS.map((group) => (
            <section key={group.title} className="mb-3">
              <h4 className="m-0 mb-1 text-muted-foreground text-caption font-semibold">{t(group.title)}</h4>
              {group.roles.map(({ role, label }) => (
                <ColorField
                  key={`${variant}-${role}`}
                  label={label}
                  value={draft[variant].colors[role]}
                  original={original[variant].colors[role]}
                  onChange={(color) => {
                    setLocked((current) => ({
                      ...current,
                      [variant]: [...new Set([...current[variant], role])],
                    }))
                    commit({
                      ...draft,
                      [variant]: { ...draft[variant], colors: { ...draft[variant].colors, [role]: color } },
                    })
                  }}
                />
              ))}
            </section>
          ))}
        </div>
        {issues.length > 0 && (
          <ul role="alert" className="m-0 p-0 list-none text-caption text-bad max-h-24 overflow-y-auto">
            {issues.map((issue) => (
              <li key={`${issue.variant}-${issue.role}-${issue.message}`}>
                {issue.variant === 'light' ? t('Light') : t('Dark')}: {issue.message}
              </li>
            ))}
          </ul>
        )}
        {notice && <p className="m-0 text-caption text-warn">{notice}</p>}
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" disabled={issues.length > 0} onClick={() => void shareTheme(draft, 'download')}>
            {t('Export file')}
          </Button>
          <Button
            variant="ghost"
            disabled={!brief.trim()}
            onClick={async () =>
              void navigator.clipboard.writeText(
                themeRecipe({ name: draft.name, brief, digest: await themeDigest(draft) }),
              )
            }
          >
            {t('Copy recipe')}
          </Button>
          <Button variant="ghost" disabled={issues.length > 0} onClick={() => void shareTheme(draft, 'copy')}>
            {t('Copy JSON')}
          </Button>
        </div>
        <div
          className="theme-recovery-bar flex items-center justify-end gap-2 rounded-(--radius-s) p-2"
          role="group"
          aria-label={t('Try this theme')}
        >
          <span className="flex-1 text-caption">
            {t('Trying this theme in the app. Revert restores the previous one.')}
          </span>
          <ThemeRecoveryButton onClick={revert}>{t('Revert')}</ThemeRecoveryButton>
          <ThemeRecoveryButton variant="solid" disabled={issues.length > 0} onClick={keep}>
            {t('Keep theme')}
          </ThemeRecoveryButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Paste a shared theme's JSON; Preview opens it in the editor's trial, so nothing applies until it is kept. */
export function PasteTheme({
  onClose,
  onPreview,
}: {
  onClose: () => void
  onPreview: (text: string) => Promise<boolean>
}) {
  const [text, setText] = useState('')
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="w-[min(520px,calc(100vw-40px))] sm:max-w-none flex flex-col gap-3"
        aria-describedby={undefined}
      >
        <DialogTitle>{t('Paste theme JSON')}</DialogTitle>
        <textarea
          aria-label={t('Theme JSON')}
          value={text}
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
          className="h-48 font-mono text-caption p-2 resize-none"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            disabled={!text.trim()}
            onClick={async () => {
              if (await onPreview(text)) onClose()
            }}
          >
            {t('Preview')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
