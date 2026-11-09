import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  IDENTITY_COLORS,
  identitiesOffered,
  parseRule,
  ruleText,
  type Identity,
  type IdentitySnapshot,
} from '@ramu/shared/identities'
import type { Project } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { Badge } from '@/components/ui/badge'
import { Dialog, Dropdown } from '../Menu'
import { useViewOnly } from '../composer/useViewOnly'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { IdentityDot } from './IdentityChip'
import { SettingsCard, SettingsCardList, SettingsEmpty, SettingsSectionHead } from './cards'
import { useSettingsEvents, useSettingsInvoke } from './SettingsScope'

const COLOR_NAMES: Record<Identity['color'], string> = {
  violet: 'Violet',
  blue: 'Blue',
  green: 'Green',
  amber: 'Amber',
  red: 'Red',
  pink: 'Pink',
  teal: 'Teal',
  gray: 'Gray',
}

function IdentityCard({
  identity,
  snapshot,
  projects,
  busy,
  viewOnly,
  onChange,
  onRemove,
}: {
  identity: Identity
  snapshot: IdentitySnapshot
  projects: Project[]
  busy: boolean
  viewOnly: boolean
  onChange: (patch: Partial<Identity>) => void
  onRemove: () => void
}) {
  const [name, setName] = useState(identity.name)
  const [author, setAuthor] = useState(identity.gitAuthor.name)
  const [email, setEmail] = useState(identity.gitAuthor.email)
  const [rule, setRule] = useState('')
  const [ruleError, setRuleError] = useState<string | null>(null)
  const caught = snapshot.projects.filter((entry) => entry.identityId === identity.id)
  const changed = name !== identity.name || author !== identity.gitAuthor.name || email !== identity.gitAuthor.email
  return (
    <SettingsCard
      title={
        <span className="flex items-center gap-2">
          <IdentityDot color={identity.color} />
          {identity.name}
        </span>
      }
      badges={identity.isDefault ? <Badge variant="secondary">{t('Default')}</Badge> : undefined}
      meta={`${identity.gitAuthor.name} <${identity.gitAuthor.email}>`}
      actions={
        <>
          {!identity.isDefault && (
            <Button size="sm" variant="ghost" disabled={viewOnly || busy} onClick={() => onChange({ isDefault: true })}>
              {t('Make default')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('Remove {name}', { name: identity.name })}
            disabled={viewOnly || busy || snapshot.settings.identities.length < 2}
            onClick={onRemove}
          >
            <Trash2 size={13} />
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-1.5">
        <Input
          aria-label={t('Name')}
          value={name}
          maxLength={60}
          disabled={viewOnly}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          aria-label={t('Git author name')}
          value={author}
          maxLength={120}
          disabled={viewOnly}
          onChange={(e) => setAuthor(e.target.value)}
        />
        <Input
          aria-label={t('Git author email')}
          value={email}
          maxLength={200}
          disabled={viewOnly}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Dropdown
          label={t('Color')}
          value={identity.color}
          options={IDENTITY_COLORS.map((color) => ({ value: color, label: t(COLOR_NAMES[color]) }))}
          onChange={(color) => onChange({ color: color as Identity['color'] })}
          disabled={viewOnly || busy}
        />
        {changed && (
          <Button
            size="sm"
            disabled={viewOnly || busy || !name.trim() || !email.trim()}
            onClick={() => onChange({ name, gitAuthor: { ...identity.gitAuthor, name: author, email } })}
          >
            {t('Save')}
          </Button>
        )}
      </div>
      <p className="m-0 text-caption text-muted-foreground">
        {t('Rules pick this identity for a project from its folder or remote.')}
      </p>
      <ul className="m-0 flex flex-wrap gap-1 p-0">
        {identity.rules.map((entry) => (
          <li key={ruleText(entry)} className="list-none">
            <Badge variant="outline">
              {ruleText(entry)}
              <Button
                size="sm"
                variant="ghost"
                className="h-4 px-1"
                aria-label={t('Remove {name}', { name: ruleText(entry) })}
                disabled={viewOnly || busy}
                onClick={() => onChange({ rules: identity.rules.filter((other) => other !== entry) })}
              >
                ×
              </Button>
            </Badge>
          </li>
        ))}
      </ul>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          const parsed = parseRule(rule)
          if (!parsed) return setRuleError(t('Use a folder such as ~/work/** or a remote such as github.com/acme.'))
          setRuleError(null)
          setRule('')
          onChange({ rules: [...identity.rules, parsed] })
        }}
      >
        <Input
          aria-label={t('Add a rule')}
          placeholder="~/work/**  ·  github.com/acme"
          value={rule}
          maxLength={500}
          disabled={viewOnly}
          onChange={(e) => setRule(e.target.value)}
        />
        <Button type="submit" size="sm" variant="secondary" disabled={viewOnly || busy || !rule.trim()}>
          {t('Add rule')}
        </Button>
      </form>
      {ruleError && <p className="m-0 text-caption text-bad">{ruleError}</p>}
      <p className="m-0 text-caption text-muted-foreground">
        {caught.length
          ? t('Projects: {names}', {
              names: caught
                .map((entry) => projects.find((project) => project.id === entry.projectId)?.name ?? entry.projectId)
                .join(', '),
            })
          : t('No project uses it yet.')}
      </p>
    </SettingsCard>
  )
}

/** "Projects from github.com/acme use Work?": yes adds the rule, either answer stops asking for that project. */
function Suggestion({
  text,
  project,
  identities,
  busy,
  onAnswer,
}: {
  text: string
  project: string
  identities: Identity[]
  busy: boolean
  onAnswer: (identityId: string | null) => void
}) {
  const [choice, setChoice] = useState(identities.find((identity) => !identity.isDefault)?.id ?? identities[0]!.id)
  return (
    <SettingsCard
      title={t('Projects from {remote} use…', { remote: text })}
      meta={t('Suggested by {project}', { project })}
      actions={
        <>
          <Dropdown
            label={t('Identity')}
            value={choice}
            options={identities.map((identity) => ({ value: identity.id, label: identity.name }))}
            onChange={setChoice}
            disabled={busy}
          />
          <Button size="sm" disabled={busy} onClick={() => onAnswer(choice)}>
            {t('Add rule')}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAnswer(null)}>
            {t('Not now')}
          </Button>
        </>
      }
    />
  )
}

/**
 * Settings › Identities: work, personal and client identities, each with its Git author, the rules that pick it from a
 * project's folder or remote, and which connected accounts belong to it. Every account is for all identities until it
 * is put in one.
 */
export function IdentitySettings() {
  useLanguage()
  const invoke = useSettingsInvoke()
  const on = useSettingsEvents()
  const viewOnly = useViewOnly()
  const [snapshot, setSnapshot] = useState<IdentitySnapshot | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [removing, setRemoving] = useState<Identity | null>(null)
  const [moveTo, setMoveTo] = useState('')
  const [adding, setAdding] = useState<{ name: string; author: string; email: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(
    () => void invoke('identities.get').then(setSnapshot, (cause) => setError(errorText(cause))),
    [invoke],
  )
  useEffect(() => {
    reload()
    void invoke('projects.list').then(setProjects, () => {})
    return on('identities:changed', reload)
  }, [invoke, on, reload])
  const act = async (run: () => Promise<IdentitySnapshot | unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const next = await run()
      if (next && typeof next === 'object' && 'settings' in next) setSnapshot(next as IdentitySnapshot)
      return true
    } catch (cause) {
      setError(errorText(cause))
      return false
    } finally {
      setBusy(false)
    }
  }
  if (!snapshot) return error ? <p className="text-bad">{error}</p> : null
  const { identities } = snapshot.settings
  const offered = identitiesOffered(snapshot)
  return (
    <section className="flex flex-col gap-2" aria-label={t('Identities')}>
      <SettingsSectionHead
        title={t('Identities')}
        help={t(
          'Accounts that belong together, such as work and personal. Each project acts as one, picked from its folder or remote: its threads, commits, pull requests and deploys use that identity’s accounts.',
        )}
        action={
          <Button
            size="sm"
            variant="secondary"
            disabled={viewOnly || busy}
            onClick={() =>
              setAdding({
                name: identities.length ? '' : t('Personal'),
                author: identities[0]?.gitAuthor.name ?? '',
                email: '',
              })
            }
          >
            <Plus size={13} />
            {t('Add identity')}
          </Button>
        }
      />
      {error && (
        <p role="alert" className="m-0 text-caption text-bad">
          {error}
        </p>
      )}
      {!identities.length && (
        <SettingsEmpty>
          {offered
            ? t('You have more than one account of a kind. Add an identity for each, such as Work and Personal.')
            : t(
                'With one account of each kind nothing changes. Add identities once you connect a second account, such as a work login.',
              )}
        </SettingsEmpty>
      )}
      {identities.length >= 2 &&
        snapshot.suggestions?.map((suggestion) => (
          <Suggestion
            key={suggestion.projectId}
            text={ruleText(suggestion.rule)}
            project={projects.find((project) => project.id === suggestion.projectId)?.name ?? suggestion.projectId}
            identities={identities}
            busy={busy || viewOnly}
            onAnswer={(identityId) =>
              void act(() =>
                invoke(
                  'identities.answerSuggestion',
                  suggestion.projectId,
                  identityId,
                  identityId ? suggestion.rule : null,
                ),
              )
            }
          />
        ))}
      <SettingsCardList>
        {identities.map((identity) => (
          <IdentityCard
            key={identity.id}
            identity={identity}
            snapshot={snapshot}
            projects={projects}
            busy={busy}
            viewOnly={viewOnly}
            onChange={(patch) => void act(() => invoke('identities.update', identity.id, patch as never))}
            onRemove={() => {
              setRemoving(identity)
              setMoveTo(identities.find((other) => other.id !== identity.id)?.id ?? '')
            }}
          />
        ))}
      </SettingsCardList>

      {identities.length >= 2 && (
        <>
          <SettingsSectionHead
            title={t('Accounts')}
            help={t(
              'Every account is for all identities until you put it in one. An identity uses its own account of a kind first, and never another identity’s.',
            )}
          />
          <SettingsCardList>
            {snapshot.accounts.map((account) => {
              const owners = snapshot.settings.accounts[account.key] ?? []
              return (
                <SettingsCard
                  key={account.key}
                  title={account.label}
                  actions={
                    <Dropdown
                      label={t('Which identities is it for?')}
                      value={owners.length === 1 ? owners[0]! : ''}
                      options={[
                        { value: '', label: t('All identities') },
                        ...identities.map((identity) => ({ value: identity.id, label: identity.name })),
                      ]}
                      onChange={(value) =>
                        void act(() => invoke('identities.assign', account.key, value ? [value] : []))
                      }
                      disabled={viewOnly || busy}
                    />
                  }
                />
              )
            })}
          </SettingsCardList>
          <SettingsSectionHead
            title={t('Projects')}
            help={t('Pin a project to another identity; it follows its rules otherwise.')}
          />
          <SettingsCardList>
            {snapshot.projects.map((entry) => (
              <SettingsCard
                key={entry.projectId}
                title={projects.find((project) => project.id === entry.projectId)?.name ?? entry.projectId}
                meta={
                  entry.reason === 'pinned'
                    ? t('Pinned')
                    : entry.reason === 'rule'
                      ? t('Picked by a rule')
                      : t('Default identity')
                }
                actions={
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t('Sets user.name and user.email in its repositories, for commits made outside Ramu.')}
                      disabled={viewOnly || busy}
                      onClick={() => void act(() => invoke('identities.writeGitConfig', entry.projectId))}
                    >
                      {t('Write to Git config')}
                    </Button>
                    <Dropdown
                      label={t('Identity')}
                      value={entry.reason === 'pinned' ? entry.identityId : ''}
                      options={[
                        { value: '', label: t('Follow its rules') },
                        ...identities.map((identity) => ({ value: identity.id, label: identity.name })),
                      ]}
                      onChange={(value) => void act(() => invoke('identities.pin', entry.projectId, value || null))}
                      disabled={viewOnly || busy}
                    />
                  </>
                }
              />
            ))}
          </SettingsCardList>
        </>
      )}

      {adding && (
        <Dialog
          title={t('Add identity')}
          confirmLabel={t('Add identity')}
          busy={busy}
          error={error}
          confirmDisabled={!adding.name.trim() || !adding.email.trim() || !adding.author.trim()}
          onCancel={() => setAdding(null)}
          onConfirm={() =>
            void act(() =>
              invoke('identities.add', { name: adding.name, gitAuthor: { name: adding.author, email: adding.email } }),
            ).then((ok) => ok && setAdding(null))
          }
        >
          <div className="flex flex-col gap-1.5">
            <Input
              aria-label={t('Name')}
              placeholder={t('Work')}
              value={adding.name}
              maxLength={60}
              onChange={(e) => setAdding({ ...adding, name: e.target.value })}
            />
            <Input
              aria-label={t('Git author name')}
              placeholder={t('Git author name')}
              value={adding.author}
              maxLength={120}
              onChange={(e) => setAdding({ ...adding, author: e.target.value })}
            />
            <Input
              aria-label={t('Git author email')}
              placeholder="you@company.com"
              value={adding.email}
              maxLength={200}
              onChange={(e) => setAdding({ ...adding, email: e.target.value })}
            />
          </div>
        </Dialog>
      )}
      {removing && (
        <Dialog
          title={t('Remove {name}?', { name: removing.name })}
          confirmLabel={t('Remove')}
          danger
          busy={busy}
          error={error}
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            void act(() => invoke('identities.remove', removing.id, moveTo || null)).then(
              (ok) => ok && setRemoving(null),
            )
          }
        >
          <Dropdown
            label={t('Move its projects to')}
            value={moveTo}
            options={identities
              .filter((identity) => identity.id !== removing.id)
              .map((identity) => ({ value: identity.id, label: identity.name }))}
            onChange={setMoveTo}
          />
        </Dialog>
      )}
    </section>
  )
}
