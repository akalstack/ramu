import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Textarea } from '@/components/ui/textarea'
import { t } from '../i18n'
import { Dropdown } from '../Menu'
import { modelStepName, useModelSets } from '../models/ModelSets'
import { SETTINGS_FORM_CLASS } from './constants'
import { ToggleRow, type DraftProps } from './ToggleRow'

export function GitSettings({ draft, onChange, busy }: DraftProps) {
  const toggleProps = { draft, onChange, busy }
  const models = useModelSets()
  const steps = models.preferences.sets.flatMap((set) => set.steps)
  const commitStepId =
    steps.find(
      (step) =>
        step.provider === draft.commitModel?.provider &&
        step.model === draft.commitModel.model &&
        step.effort === draft.commitModel.effort,
    )?.id ?? ''
  return (
    <div className={SETTINGS_FORM_CLASS}>
      <SettingsGroupTitle>{t('Sync')}</SettingsGroupTitle>
      <ToggleRow
        {...toggleProps}
        setting="autoPull"
        title="Automatic pull"
        description="Pull when the checkout is clean and can fast-forward. Skipped while an agent is working, files are unsaved, or Git is busy."
      />
      <SettingsRow setting="pullMode">
        <SettingsLabel
          title={t('Pull behavior')}
          help={t(
            'How Pull and Sync combine local and remote commits. Tracked edits are stashed and restored for you.',
          )}
        />
        <Dropdown
          label={t('Pull behavior')}
          value={draft.pullMode}
          options={[
            { value: 'rebase', label: 'Rebase' },
            { value: 'merge', label: 'Merge' },
            { value: 'ff-only', label: t('Fast-forward only') },
          ]}
          onChange={(value) =>
            onChange({ ...draft, pullMode: value === 'merge' || value === 'ff-only' ? value : 'rebase' })
          }
        />
      </SettingsRow>
      <SettingsGroupTitle>{t('Commits')}</SettingsGroupTitle>
      <SettingsRow setting="commitStyle">
        <SettingsLabel title={t('Commit messages')} help={t('Style for generated commit messages.')} />
        <Dropdown
          label={t('Commit message style')}
          value={draft.commitStyle}
          options={[
            { value: 'conventional', label: t('Conventional commits') },
            { value: 'repository', label: t('Repository convention') },
            { value: 'custom', label: t('Custom instructions') },
          ]}
          onChange={(value) =>
            onChange({ ...draft, commitStyle: value === 'repository' || value === 'custom' ? value : 'conventional' })
          }
        />
      </SettingsRow>
      <SettingsRow setting="commitModel">
        <SettingsLabel
          title={t('Commit message model')}
          help={t('Model that drafts commit messages. Default follows the default model in Models & fallback.')}
        />
        <Dropdown
          label={t('Commit message model')}
          value={commitStepId}
          options={[
            { value: '', label: t('Default model') },
            ...steps.map((step) => ({ value: step.id, label: modelStepName(step, models.catalogs) })),
          ]}
          onChange={(id) => {
            const step = steps.find((step) => step.id === id)
            onChange({
              ...draft,
              commitModel: step ? { provider: step.provider, model: step.model, effort: step.effort } : null,
            })
          }}
        />
      </SettingsRow>
      {draft.commitStyle === 'custom' && (
        <SettingsRow setting="commitInstructions" className="settings-stack">
          <SettingsLabel
            title={t('Commit instructions')}
            help={t(
              'For example: start with a ticket key like ABC-123, write in English, keep the subject under 50 characters.',
            )}
          />
          <Textarea
            rows={4}
            maxLength={2000}
            value={draft.commitInstructions}
            aria-label={t('Commit message instructions')}
            placeholder={t('Describe how commit messages should be written')}
            onChange={(event) => onChange({ ...draft, commitInstructions: event.target.value })}
          />
        </SettingsRow>
      )}
      <SettingsRow setting="defaultCommitBranch">
        <SettingsLabel
          title={t('Commit from default branch')}
          help={t('What to do when you commit and push while on the default branch.')}
        />
        <Dropdown
          label={t('Commit from default branch')}
          value={draft.defaultCommitBranch}
          options={[
            { value: 'new-branch', label: t('Create feature branch') },
            { value: 'current', label: t('Continue on current branch') },
          ]}
          onChange={(value) =>
            onChange({ ...draft, defaultCommitBranch: value === 'current' ? 'current' : 'new-branch' })
          }
        />
      </SettingsRow>
      <SettingsGroupTitle>{t('Source control')}</SettingsGroupTitle>
      <ToggleRow
        {...toggleProps}
        setting="combineGitChanges"
        title="Combine staged and unstaged changes"
        description="Show each file once and commit all changes. Turn off to stage files separately before committing."
      />
      <p className="muted text-muted-foreground small text-caption">
        {t('Discard and delete actions show their affected files before running. Explorer deletion is permanent.')}
      </p>
    </div>
  )
}
