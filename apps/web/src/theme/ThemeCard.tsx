import { useMemo, useState } from 'react'
import { parseTheme, type RamuTheme } from '@ramu/shared/theme'
import { Button } from '@/components/desktop-button'
import { resolvedAppearance } from '../appearance'
import { t } from '../i18n'
import { ThemePreview } from './ThemePreview'
import { ThemeEditor } from './ThemeEditor'

/**
 * A theme an agent drafted in a thread. Previewing opens the same trial, edit and Keep/Revert flow as an imported file,
 * so only the person's own Keep changes the app, and closing the editor restores the previous look.
 */
export function ThemeCard({ theme }: { theme: RamuTheme }) {
  const parsed = useMemo(() => parseTheme(theme), [theme])
  const [open, setOpen] = useState(false)
  if (!parsed.ok) return null
  const variant = parsed.theme[resolvedAppearance()]
  return (
    <div className="flex flex-col gap-2 rounded-(--radius-m) p-3 [border:1px_solid_var(--line)] max-w-[420px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold truncate">{parsed.theme.name}</span>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {t('Preview theme')}
        </Button>
      </div>
      <ThemePreview variant={variant} compact />
      <p className="m-0 text-caption text-muted-foreground">
        {t('Drafted by the agent. Nothing changes until you keep it.')}
      </p>
      {open && <ThemeEditor imported={parsed.theme} onClose={() => setOpen(false)} />}
    </div>
  )
}
