import { STACKS, STACK_IDS } from '@ramu/shared/stacks'
import { Input } from '@/components/desktop-input'
import { Combobox } from '@/components/combobox'
import { t } from '../i18n'
import { ProjectParentField, type useProjectParent } from '../workspace/ProjectParentField'
import { catalogStack, stackName, type NewProjectDraft, type StackChoice } from './newProjectDraft'

/**
 * Name, stack and folder for a new project. An empty name leaves the name and stack to the agent, which asks what to
 * build first; with a name, the person picks the stack, lets the agent recommend one, or names any framework for the
 * agent to look up.
 */
export function NewProjectFields({
  value,
  onChange,
  disabled,
  designs = [],
  onFromDesign,
  location,
}: {
  value: NewProjectDraft
  onChange: (value: NewProjectDraft) => void
  disabled: boolean
  /** Design artifacts a project can start from: its first screens are built to match. */
  designs?: { id: string; title: string }[]
  onFromDesign?: (designId: string) => void
  /** Where Ramu puts the project's folder, shown once a name or design means Ramu makes it. */
  location: ReturnType<typeof useProjectParent>
}) {
  const named = !!value.name.trim()
  const known = catalogStack(value)
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
            { value: '', label: t('Agent recommends'), detail: t('No framework unless the app needs one') },
            ...(['No framework', 'Framework'] as const).flatMap((group) => [
              ...STACK_IDS.filter((id) => STACKS[id].framework === (group === 'Framework')).map((id) => ({
                value: id,
                label: stackName(id),
                detail: t(STACKS[id].summary),
                group: t(group),
              })),
              group === 'Framework'
                ? { value: 'other', label: t('Other framework…'), group: t(group) }
                : {
                    value: 'none',
                    label: t('No generator'),
                    detail: t('The agent writes every file'),
                    group: t(group),
                  },
            ]),
          ]}
          onChange={(stack) => onChange({ ...value, stack: stack as StackChoice })}
        />
      )}
      {named && value.stack === 'other' && (
        <Input
          className="h-7 w-[180px]"
          value={value.framework}
          maxLength={60}
          spellCheck={false}
          disabled={disabled}
          aria-label={t('Framework')}
          placeholder={t('Framework, such as Tauri')}
          onChange={(event) => onChange({ ...value, framework: event.target.value })}
        />
      )}
      <span className="text-caption text-muted-foreground">
        {!named
          ? t('Leave it empty and the agent asks a few questions first')
          : known
            ? t(STACKS[known].summary)
            : value.stack === 'none'
              ? t('An empty project the agent fills in')
              : value.stack === 'other'
                ? t('The agent looks up its official setup and shows you the commands first')
                : t('The agent asks what it needs and recommends a stack')}
      </span>
      {(named || designs.length > 0) && <ProjectParentField location={location} disabled={disabled} />}
    </div>
  )
}
