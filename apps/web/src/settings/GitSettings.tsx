import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Input } from '@/components/desktop-input'
import { branchForTitle, validBranchPrefix } from '@ramu/shared/workspaceDefaults'
import { Textarea } from '@/components/ui/textarea'
import { t } from '../i18n'
import { Dropdown } from '../Menu'
import { ModelChoice } from './ModelChoice'
import { SETTINGS_FORM_CLASS } from './constants'
import { ToggleRow, type DraftProps } from './ToggleRow'
import { HostingAccounts } from './HostingAccounts'

export function GitSettings({ draft, onChange, busy }: DraftProps) {
  const toggleProps = { draft, onChange, busy }
  return (
    <div className={SETTINGS_FORM_CLASS}>
      <HostingAccounts />
      <SettingsGroupTitle>{t('New threads & worktrees')}</SettingsGroupTitle>
      <p className="m-0 text-caption text-muted-foreground">
        {t('Repository configuration can override these defaults. Each draft can override repository settings.')}
      </p>
      <SettingsRow setting="defaultCheckoutMode">
        <SettingsLabel
          title={t('Default workspace for new threads')}
          help={t('Choose the current checkout or an isolated worktree. Each draft can override this default.')}
        />
        <Dropdown
          label={t('Default workspace for new threads')}
          value={draft.defaultCheckoutMode}
          options={[
            { value: 'current', label: t('Current checkout') },
            { value: 'worktree', label: t('New worktree') },
          ]}
          onChange={(value) =>
            onChange({ ...draft, defaultCheckoutMode: value === 'worktree' ? 'worktree' : 'current' })
          }
        />
      </SettingsRow>
      <SettingsRow setting="worktreeBranchNaming">
        <SettingsLabel
          title={t('Worktree branch naming')}
          help={t('Generated names use the opening message. If generation fails, Ramu uses a default name.')}
        />
        <Dropdown
          label={t('Worktree branch naming')}
          value={draft.worktreeBranchNaming}
          options={[
            { value: 'fixed', label: t('Fixed prefix') },
            { value: 'semantic', label: t('Semantic name') },
            { value: 'custom', label: t('Custom instructions') },
          ]}
          onChange={(value) =>
            onChange({ ...draft, worktreeBranchNaming: value === 'semantic' || value === 'custom' ? value : 'fixed' })
          }
        />
      </SettingsRow>
      {draft.worktreeBranchNaming === 'custom' && (
        <SettingsRow setting="worktreeBranchInstructions" className="settings-stack">
          <SettingsLabel
            title={t('Branch naming instructions')}
            help={t('Describe the complete branch name, including any ticket or team prefix.')}
          />
          <Textarea
            rows={3}
            maxLength={2000}
            aria-label={t('Branch naming instructions')}
            value={draft.worktreeBranchInstructions}
            onChange={(event) => onChange({ ...draft, worktreeBranchInstructions: event.target.value })}
          />
        </SettingsRow>
      )}
      {draft.worktreeBranchNaming === 'fixed' && (
        <SettingsRow setting="worktreeBranchPrefix" className="settings-stack">
          <SettingsLabel
            title={t('Branch prefix')}
            help={
              validBranchPrefix(draft.worktreeBranchPrefix)
                ? branchForTitle('Fix login timeout', draft.worktreeBranchPrefix)
                : t('Invalid Git branch prefix')
            }
          />
          <Input
            aria-label={t('Branch prefix')}
            maxLength={120}
            value={draft.worktreeBranchPrefix}
            aria-invalid={!validBranchPrefix(draft.worktreeBranchPrefix)}
            onChange={(event) => onChange({ ...draft, worktreeBranchPrefix: event.target.value })}
          />
        </SettingsRow>
      )}
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
      <SettingsGroupTitle>{t('Pull requests')}</SettingsGroupTitle>
      <ToggleRow
        {...toggleProps}
        setting="autoWatchPullRequests"
        title="Automatically watch pull requests"
        description="Watch pull requests you create from a thread. New failures and requested changes go back to that thread, and you review and push. Manage existing watches in Source Control."
      />
      <SettingsGroupTitle>{t('Generated text')}</SettingsGroupTitle>
      <ToggleRow
        {...toggleProps}
        setting="removeAgentCredits"
        title="Remove agent credits"
        description="Keep AI agent Co-authored-by trailers and Generated with lines out of commits and pull requests. Agents are told not to add them, and Ramu strips any that remain. Credits for people stay."
      />
      <SettingsRow setting="commitModel">
        <SettingsLabel
          title={t('Writing model')}
          help={t('Writes commit messages and pull request titles and descriptions. Default uses your default model.')}
        />
        <ModelChoice
          label={t('Writing model')}
          value={draft.commitModel}
          emptyLabel={t('Default model')}
          onChange={(commitModel) => onChange({ ...draft, commitModel })}
        />
      </SettingsRow>
      <SettingsRow setting="commitStyle">
        <SettingsLabel title={t('Style')} help={t('How commit messages and pull request titles are worded.')} />
        <Dropdown
          label={t('Writing style')}
          value={draft.commitStyle}
          options={[
            { value: 'conventional', label: t('Conventional commits') },
            { value: 'repository', label: t('Match this repository') },
            { value: 'custom', label: t('My own instructions') },
          ]}
          onChange={(value) =>
            onChange({ ...draft, commitStyle: value === 'repository' || value === 'custom' ? value : 'conventional' })
          }
        />
      </SettingsRow>
      {draft.commitStyle === 'custom' && (
        <SettingsRow setting="commitInstructions" className="settings-stack">
          <SettingsLabel
            title={t('Writing instructions')}
            help={t(
              'Used for commit messages and pull requests. For example: start with a ticket key like ABC-123, write in English, keep the subject under 50 characters.',
            )}
          />
          <Textarea
            rows={4}
            maxLength={2000}
            value={draft.commitInstructions}
            aria-label={t('Writing instructions')}
            placeholder={t('Describe how commit messages and pull requests should be written')}
            onChange={(event) => onChange({ ...draft, commitInstructions: event.target.value })}
          />
        </SettingsRow>
      )}
      <SettingsGroupTitle>{t('Commits')}</SettingsGroupTitle>
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
    </div>
  )
}
