import { Kbd } from '@/components/ui/kbd'
import { formatKeys } from '../commands'
import { t } from '../i18n'

export type Shortcut = { title: string; category: string; keys: string }

export function ShortcutsSettings({ shortcuts }: { shortcuts: Shortcut[] }) {
  return (
    <div className="settings-shortcuts">
      <p className="muted text-muted-foreground">{t('App shortcuts. Editor shortcuts follow VS Code.')}</p>
      {[
        { title: t('Send / default queue or steer action'), category: t('Composer'), keys: 'Enter' },
        { title: t('Reverse queue / steer action'), category: t('Composer'), keys: 'mod+Enter' },
        { title: t('New line'), category: t('Composer'), keys: 'shift+Enter' },
        ...shortcuts,
      ].map((shortcut) => (
        <div
          className="settings-shortcut [&_kbd]:flex-none flex items-center gap-4 justify-between p-[9px_0] [border-bottom:1px_solid_var(--line)]"
          key={`${shortcut.title}:${shortcut.keys}`}
        >
          <span>
            <span className="muted text-muted-foreground small text-caption">{shortcut.category} · </span>
            {shortcut.title}
          </span>
          <Kbd>{formatKeys(shortcut.keys)}</Kbd>
        </div>
      ))}
    </div>
  )
}
