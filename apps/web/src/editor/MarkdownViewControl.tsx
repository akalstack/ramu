import { Code2, Eye, Pencil } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { DEFAULT_APP_PREFERENCES, type AppPreferences } from '@ramu/shared/types'
import { t } from '../i18n'

type MarkdownView = AppPreferences['defaultMarkdownView']

export function initialMarkdownView(preferred: MarkdownView | undefined, hasSelection: boolean): MarkdownView {
  return hasSelection ? 'source' : (preferred ?? DEFAULT_APP_PREFERENCES.defaultMarkdownView)
}

export function MarkdownViewControl({
  mode,
  onChange,
  diagram = false,
}: {
  mode: MarkdownView
  onChange: (mode: MarkdownView) => void
  /** A Mermaid file: its source or its diagram, with no rendered editor. */
  diagram?: boolean
}) {
  return (
    <ToggleGroup
      size="sm"
      spacing={0}
      aria-label={diagram ? t('Diagram view') : t('Markdown view')}
      value={[mode]}
      onValueChange={(values) => {
        const next = values[0]
        if (next === 'source' || next === 'edit' || next === 'preview') onChange(next)
      }}
    >
      <ToggleGroupItem value="source" aria-label={t('Source')} title={t('Source')}>
        <Code2 />
      </ToggleGroupItem>
      {!diagram && (
        <ToggleGroupItem value="edit" aria-label={t('Edit')} title={t('Edit rendered Markdown')}>
          <Pencil />
        </ToggleGroupItem>
      )}
      <ToggleGroupItem
        value="preview"
        aria-label={t('Preview')}
        title={diagram ? t('Show diagram') : t('Preview Markdown without editing')}
      >
        <Eye />
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
