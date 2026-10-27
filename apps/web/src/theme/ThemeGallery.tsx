import { useState } from 'react'
import {
  Check,
  ClipboardPaste,
  Copy,
  Download,
  FileUp,
  MoreHorizontal,
  Pencil,
  Plus,
  SwatchBook,
  Trash2,
} from 'lucide-react'
import { DEFAULT_THEME, type RamuTheme } from '@ramu/shared/theme'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { useResolvedAppearance } from '../appearance'
import { t } from '../i18n'
import { Dialog, Menu, type MenuEntry } from '../Menu'
import { builtInThemes, copyOfTheme, removeTheme, renameTheme, selectTheme } from './themes'
import { useSelectedTheme, useThemeLibrary } from './themes'
import { shareTheme } from './ThemeEditor'

/** A small picture of the theme in the current appearance: sidebar, main surface, a message, text and the primary action. */
function Thumb({ theme }: { theme: RamuTheme }) {
  const appearance = useResolvedAppearance()
  const c = theme[appearance].colors
  return (
    <div
      aria-hidden
      className="relative h-[78px] overflow-hidden rounded-(--radius-s) [border:1px_solid_var(--line)]"
      style={{ background: c.window }}
    >
      <div className="absolute left-2 top-2.5 flex w-[18%] flex-col gap-1.5">
        <span className="h-1 rounded-full" style={{ background: c.text, opacity: 0.85 }} />
        <span className="h-1 w-3/4 rounded-full" style={{ background: c.muted }} />
        <span className="h-1 w-2/3 rounded-full" style={{ background: c.muted }} />
      </div>
      <div
        className="absolute bottom-0 left-[26%] right-0 top-2 flex flex-col gap-1.5 rounded-tl-md p-2"
        style={{ background: c.canvas, boxShadow: `0 0 0 1px ${c.raised}` }}
      >
        <span className="h-1 w-2/5 rounded-full" style={{ background: c.text }} />
        <span className="h-1 w-3/5 rounded-full" style={{ background: c.textBody, opacity: 0.7 }} />
        <span className="ml-auto h-3 w-1/2 rounded-md" style={{ background: c.bubble }} />
        <div className="mt-auto flex items-center gap-1.5">
          <span className="h-3 w-8 rounded-full" style={{ background: c.primary }} />
          <span className="size-2 rounded-full" style={{ background: c.accent }} />
          <span className="size-2 rounded-full" style={{ background: c.ok }} />
          <span className="size-2 rounded-full" style={{ background: c.warn }} />
          <span className="size-2 rounded-full" style={{ background: c.bad }} />
        </div>
      </div>
    </div>
  )
}

function Tile({
  theme,
  selected,
  yours,
  actions,
}: {
  theme: RamuTheme
  selected: boolean
  yours: boolean
  actions: MenuEntry[]
}) {
  return (
    <div
      className={`group relative flex flex-col gap-2 rounded-(--radius-m) bg-fill p-2 transition-colors [&:hover]:bg-hover ${
        selected ? '[box-shadow:0_0_0_2px_var(--primary)]' : '[box-shadow:0_0_0_1px_var(--line)]'
      }`}
    >
      <Button
        variant="ghost"
        role="radio"
        aria-checked={selected}
        aria-label={theme.name}
        onClick={() => selectTheme(theme.id === DEFAULT_THEME.id ? null : theme.id)}
        className="h-auto w-full min-w-0 flex-col items-stretch justify-start gap-2 rounded-(--radius-s) bg-transparent p-0 text-left font-normal whitespace-normal [&:hover:not(:disabled)]:bg-transparent"
      >
        <Thumb theme={theme} />
        <span className="flex items-center gap-1.5 px-0.5 pr-7">
          <span className="min-w-0 flex-1 truncate text-control font-medium">{theme.name}</span>
          {selected && <Check size={13} className="flex-none text-(--primary)" aria-label={t('In use')} />}
        </span>
        <span className="-mt-1 px-0.5 text-caption text-muted-foreground">
          {theme.id === DEFAULT_THEME.id ? t('Default') : yours ? t('Yours') : t('Built in')}
        </span>
      </Button>
      <span className="absolute bottom-1.5 right-1.5">
        <Menu
          label={t('Theme actions for {name}', { name: theme.name })}
          icon={<MoreHorizontal size={14} />}
          items={actions}
          align="end"
        />
      </span>
    </div>
  )
}

/**
 * Settings → Appearance → Themes. Every theme the person can use sits in one gallery: Ramu Default and the themes that
 * ship with Ramu, then the ones they kept. Choosing a tile applies it at once; its menu edits, copies, renames, exports
 * or removes it. Editing a built-in theme always works on a copy, so the original stays available.
 */
export function ThemeGallery({
  onEdit,
  onImportFile,
  onPaste,
}: {
  /** Opens the editor on `theme` as a trial; the person keeps or reverts it there. */
  onEdit: (theme: RamuTheme) => void
  onImportFile: () => void
  onPaste: () => void
}) {
  const saved = useThemeLibrary()
  const current = useSelectedTheme()
  const [renaming, setRenaming] = useState<RamuTheme | null>(null)
  const [name, setName] = useState('')
  const [removing, setRemoving] = useState<RamuTheme | null>(null)
  const builtIn = [DEFAULT_THEME, ...builtInThemes()]

  const copyActions = (theme: RamuTheme): MenuEntry[] => [
    {
      key: 'duplicate',
      label: (
        <>
          <Copy size={13} />
          {t('Duplicate and edit')}
        </>
      ),
      onSelect: () => onEdit(copyOfTheme(theme, t('{name} copy', { name: theme.name }))),
    },
    {
      key: 'download',
      label: (
        <>
          <Download size={13} />
          {t('Export file')}
        </>
      ),
      onSelect: () => void shareTheme(theme, 'download'),
    },
    {
      key: 'copy-json',
      label: (
        <>
          <ClipboardPaste size={13} />
          {t('Copy JSON')}
        </>
      ),
      onSelect: () => void shareTheme(theme, 'copy'),
    },
  ]
  const builtInActions = (theme: RamuTheme): MenuEntry[] => [
    {
      key: 'customize',
      label: (
        <>
          <Pencil size={13} />
          {t('Customize a copy')}
        </>
      ),
      onSelect: () => onEdit(copyOfTheme(theme, t('{name} (custom)', { name: theme.name }))),
    },
    ...copyActions(theme).slice(1),
  ]
  const yoursActions = (theme: RamuTheme): MenuEntry[] => [
    {
      key: 'edit',
      label: (
        <>
          <Pencil size={13} />
          {t('Edit colors')}
        </>
      ),
      onSelect: () => onEdit(theme),
    },
    {
      key: 'rename',
      label: t('Rename'),
      onSelect: () => {
        setName(theme.name)
        setRenaming(theme)
      },
    },
    ...copyActions(theme),
    { key: 'separator', separator: true },
    {
      key: 'delete',
      danger: true,
      label: (
        <>
          <Trash2 size={13} />
          {t('Delete')}
        </>
      ),
      onSelect: () => setRemoving(theme),
    },
  ]

  return (
    <div className="mb-4 flex flex-col gap-3" role="radiogroup" aria-label={t('Color theme')}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex min-w-[240px] flex-1 flex-col">
          <strong className="font-medium">{t('Themes')}</strong>
          <span className="text-caption text-muted-foreground">
            {t('Pick one to use it now, on this device only. Nothing is saved until you keep a change.')}
          </span>
        </span>
        <span className="flex flex-none items-center gap-2">
          <Button variant="secondary" onClick={() => onEdit(copyOfTheme(current, t('My theme')))}>
            <Plus size={13} />
            {t('New from current')}
          </Button>
          <Button variant="secondary" onClick={onImportFile}>
            <FileUp size={13} />
            {t('Import')}
          </Button>
          <Button variant="ghost" onClick={onPaste}>
            <ClipboardPaste size={13} />
            {t('Paste JSON')}
          </Button>
        </span>
      </div>
      <section aria-label={t('Built in')} className="flex flex-col gap-2">
        <h5 className="m-0 flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
          <SwatchBook size={12} />
          {t('Built in')}
        </h5>
        <div className="grid [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
          {builtIn.map((theme) => (
            <Tile
              key={theme.id}
              theme={theme}
              selected={current.id === theme.id}
              yours={false}
              actions={builtInActions(theme)}
            />
          ))}
        </div>
      </section>
      <section aria-label={t('Yours')} className="flex flex-col gap-2">
        <h5 className="m-0 text-caption font-medium text-muted-foreground">{t('Yours')}</h5>
        {saved.length ? (
          <div className="grid [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
            {saved.map((theme) => (
              <Tile
                key={theme.id}
                theme={theme}
                selected={current.id === theme.id}
                yours
                actions={yoursActions(theme)}
              />
            ))}
          </div>
        ) : (
          <p className="m-0 rounded-(--radius-m) bg-fill px-4 py-5 text-center text-caption text-muted-foreground">
            {t('Themes you keep, import or make appear here. Customize a built-in theme to start.')}
          </p>
        )}
      </section>
      {renaming && (
        <Dialog
          title={t('Rename theme')}
          confirmLabel={t('Rename')}
          confirmDisabled={!name.trim()}
          onCancel={() => setRenaming(null)}
          onConfirm={() => {
            if (renameTheme(renaming.id, name)) setRenaming(null)
          }}
        >
          <Input
            aria-label={t('Theme name')}
            autoFocus
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && name.trim() && renameTheme(renaming.id, name)) setRenaming(null)
            }}
          />
        </Dialog>
      )}
      {removing && (
        <Dialog
          title={t('Delete {name}?', { name: removing.name })}
          confirmLabel={t('Delete')}
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            removeTheme(removing.id)
            setRemoving(null)
          }}
        >
          <p>
            {current.id === removing.id
              ? t('This theme is in use. Ramu Default takes over. You can export it first to keep a copy.')
              : t('It is removed from this device only. You can export it first to keep a copy.')}
          </p>
        </Dialog>
      )}
    </div>
  )
}
