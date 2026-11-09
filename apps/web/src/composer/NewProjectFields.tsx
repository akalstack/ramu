import { STACKS, STACK_IDS, type StackId } from '@ramu/shared/stacks'
import { Input } from '@/components/desktop-input'
import { Combobox } from '../Menu'
import { t } from '../i18n'

export interface NewProjectDraft {
  name: string
  stack: StackId | ''
}

/**
 * Name and stack for a project Ramu creates before the thread starts. An empty name leaves both to the agent, which asks
 * what to build first.
 */
export function NewProjectFields({
  value,
  onChange,
  disabled,
  designs = [],
  onFromDesign,
}: {
  value: NewProjectDraft
  onChange: (value: NewProjectDraft) => void
  disabled: boolean
  /** Design artifacts a project can start from: its first screens are built to match. */
  designs?: { id: string; title: string }[]
  onFromDesign?: (designId: string) => void
}) {
  const named = !!value.name.trim()
  return (
    <div className="flex flex-wrap items-center gap-2 px-3" role="group" aria-label={t('New project')}>
      {designs.length > 0 && onFromDesign && (
        <Combobox
          label={t('Start from a design')}
          className="min-h-7 w-[200px]"
          disabled={disabled}
          value=""
          searchPlaceholder={t('Search designs…')}
          options={[
            { value: '', label: t('Start from a design…') },
            ...designs.map((design) => ({ value: design.id, label: design.title })),
          ]}
          onChange={(designId) => designId && onFromDesign(designId)}
        />
      )}
      <Input
        className="h-7 w-[200px]"
        value={value.name}
        maxLength={100}
        spellCheck={false}
        autoCapitalize="off"
        disabled={disabled}
        aria-label={t('Project name')}
        placeholder={t('Project name (optional)')}
        onChange={(event) => onChange({ ...value, name: event.target.value })}
      />
      {named && (
        <Combobox
          label={t('Stack')}
          className="min-h-7 w-[180px]"
          disabled={disabled}
          value={value.stack}
          searchPlaceholder={t('Search stacks…')}
          options={[
            { value: '', label: t('No generator') },
            ...STACK_IDS.map((id) => ({ value: id, label: t(STACKS[id].name) })),
          ]}
          onChange={(stack) => onChange({ ...value, stack: stack as StackId | '' })}
        />
      )}
      <span className="text-caption text-muted-foreground">
        {named
          ? value.stack
            ? t(STACKS[value.stack].summary)
            : t('An empty project the agent fills in')
          : t('Leave it empty and the agent asks a few questions first')}
      </span>
    </div>
  )
}
