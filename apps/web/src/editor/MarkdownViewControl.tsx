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
}: {
  mode: MarkdownView
  onChange: (mode: MarkdownView) => void
}) {
  return (
    <ToggleGroup
      size="sm"
      spacing={0}
      aria-label={t('Markdown view')}
      value={[mode]}
      onValueChange={(values) => {
        const next = values[0]
        if (next === 'source' || next === 'edit' || next === 'preview') onChange(next)
      }}
    >
      <ToggleGroupItem value="source" aria-label={t('Source')} title={t('Source')}>
        <Code2 />
      </ToggleGroupItem>
      <ToggleGroupItem value="edit" aria-label={t('Edit')} title={t('Edit rendered Markdown')}>
        <Pencil />
      </ToggleGroupItem>
      <ToggleGroupItem value="preview" aria-label={t('Preview')} title={t('Preview Markdown without editing')}>
        <Eye />
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
