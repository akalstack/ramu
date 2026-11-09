import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Folder, GitBranch, Plus, Trash2, X } from 'lucide-react'
import { cn } from 'cn'
import {
  IDENTITY_COLORS,
  identitiesOffered,
  parseRule,
  ruleText,
  type Identity,
  type IdentityRule,
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

/** The colors as a row of swatches: one press, and the choice is visible without opening a list. */
function ColorPicker({
  value,
  disabled,
  onChange,
}: {
  value: Identity['color']
  disabled: boolean
  onChange: (color: Identity['color']) => void
}) {
  return (
    <div role="radiogroup" aria-label={t('Color')} className="flex flex-wrap items-center gap-1">
      {IDENTITY_COLORS.map((color) => (
        <Button
          key={color}
          type="button"
          variant="ghost"
          size="icon-xs"
          role="radio"
          aria-checked={value === color}
          aria-label={t(COLOR_NAMES[color])}
          title={t(COLOR_NAMES[color])}
          disabled={disabled}
          className={cn('rounded-full', value === color && 'ring-1 ring-foreground/60 ring-offset-1 ring-offset-card')}
          onClick={() => onChange(color)}
        >
          <IdentityDot color={color} className="size-3" />
        </Button>
      ))}
    </div>
  )
}

/** A labelled field in an identity card. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-caption text-muted-foreground">
      {label}
      {children}
    </label>
  )
}

/** How a typed rule will be read, before it is added, so a mistake shows while typing. */
function ruleReading(input: string): { rule: IdentityRule | null; text: string } {
  if (!input.trim()) return { rule: null, text: '' }
  const rule = parseRule(input)
  if (!rule) return { rule, text: t('Use a folder such as ~/work/** or a remote such as github.com/acme.') }
  return rule.kind === 'folder'
    ? { rule, text: t('Projects in folders matching {0}', { 0: rule.pattern }) }
    : {
        rule,
        text:
          rule.owner === '*'
            ? t('Projects with a remote on {0}', { 0: rule.host })
            : t('Projects with a remote on {0} owned by {1}', { 0: rule.host, 1: rule.owner }),
      }
}

/** The rules that pick an identity: chips, then one field that explains what it will add, and suggested rules. */
function RuleEditor({
  rules,
  suggested,
  disabled,
  onChange,
}: {
  rules: IdentityRule[]
  /** Remotes of projects that no rule catches yet, offered as one-press rules. */
  suggested: IdentityRule[]
  disabled: boolean
  onChange: (rules: IdentityRule[]) => void
}) {
  const [input, setInput] = useState('')
  const reading = ruleReading(input)
  const taken = new Set(rules.map(ruleText))
  const offers = suggested.filter((rule, index, all) => {
    const text = ruleText(rule)
    return !taken.has(text) && all.findIndex((other) => ruleText(other) === text) === index
  })
  const add = (rule: IdentityRule) => {
    if (!taken.has(ruleText(rule))) onChange([...rules, rule])
  }
  return (
    <div className="flex flex-col gap-1.5">
      {rules.length > 0 && (
        <ul className="m-0 flex flex-wrap gap-1 p-0" aria-label={t('Rules')}>
          {rules.map((entry) => (
            <li key={ruleText(entry)} className="list-none">
              <Badge variant="outline" className="h-6 gap-1 pr-0.5 font-mono text-caption">
                {entry.kind === 'folder' ? <Folder size={11} aria-hidden /> : <GitBranch size={11} aria-hidden />}
                {ruleText(entry)}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-4 min-h-4 rounded-full"
                  aria-label={t('Remove {name}', { name: ruleText(entry) })}
                  disabled={disabled}
                  onClick={() => onChange(rules.filter((other) => other !== entry))}
                >
                  <X size={10} />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (!reading.rule) return
          add(reading.rule)
          setInput('')
        }}
      >
        <Input
          aria-label={t('Add a rule')}
          className="min-w-0 flex-1 font-mono"
          placeholder={t('Folder or remote, e.g. ~/work/** or github.com/acme')}
          value={input}
          maxLength={500}
          disabled={disabled}
          autoCapitalize="none"
          spellCheck={false}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && input) {
              event.stopPropagation()
              setInput('')
            }
          }}
        />
        <Button type="submit" size="sm" variant="secondary" disabled={disabled || !reading.rule}>
          <Plus size={13} />
          {t('Add rule')}
        </Button>
      </form>
      {reading.text && (
        <p role="status" className={cn('m-0 text-caption', reading.rule ? 'text-muted-foreground' : 'text-bad')}>
          {reading.text}
        </p>
      )}
      {offers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-caption text-muted-foreground">
          {t('Suggested:')}
          {offers.map((rule) => (
            <Button
              key={ruleText(rule)}
              type="button"
              size="xs"
              variant="ghost"
              className="font-mono"
              disabled={disabled}
              onClick={() => add(rule)}
            >
              <Plus size={11} />
              {ruleText(rule)}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
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
  // A save elsewhere (another window, the phone) shows here unless this card has unsaved edits.
  useEffect(() => {
    setName(identity.name)
    setAuthor(identity.gitAuthor.name)
    setEmail(identity.gitAuthor.email)
  }, [identity.name, identity.gitAuthor.name, identity.gitAuthor.email])
  const caught = snapshot.projects.filter((entry) => entry.identityId === identity.id)
  const changed = name !== identity.name || author !== identity.gitAuthor.name || email !== identity.gitAuthor.email
  const valid = !!name.trim() && !!author.trim() && /^[^\s@]+@[^\s@]+$/.test(email.trim())
  const projectName = (id: string) => projects.find((project) => project.id === id)?.name ?? id
  const reset = () => {
    setName(identity.name)
    setAuthor(identity.gitAuthor.name)
    setEmail(identity.gitAuthor.email)
  }
  return (
    <SettingsCard
      className="gap-3! px-4! py-3!"
      title={
        <span className="flex items-center gap-2">
          <IdentityDot color={identity.color} className="size-2.5" />
          {identity.name}
        </span>
      }
      badges={identity.isDefault ? <Badge variant="secondary">{t('Default')}</Badge> : undefined}
      meta={
        caught.length
          ? t('Used by {names}', { names: caught.map((entry) => projectName(entry.projectId)).join(', ') })
          : t('No project uses it yet.')
      }
      actions={
        <>
          {!identity.isDefault && (
            <Button size="sm" variant="ghost" disabled={viewOnly || busy} onClick={() => onChange({ isDefault: true })}>
              {t('Make default')}
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('Remove {name}', { name: identity.name })}
            title={t('Remove {name}', { name: identity.name })}
            disabled={viewOnly || busy || snapshot.settings.identities.length < 2}
            onClick={onRemove}
          >
            <Trash2 size={13} />
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (changed && valid)
            onChange({
              name: name.trim(),
              gitAuthor: { ...identity.gitAuthor, name: author.trim(), email: email.trim() },
            })
        }}
      >
        <div className="grid gap-2 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
          <Field label={t('Name')}>
            <Input value={name} maxLength={60} disabled={viewOnly} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('Commit author')}>
            <Input value={author} maxLength={120} disabled={viewOnly} onChange={(e) => setAuthor(e.target.value)} />
          </Field>
          <Field label={t('Commit email')}>
            <Input
              type="email"
              value={email}
              maxLength={200}
              disabled={viewOnly}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ColorPicker value={identity.color} disabled={viewOnly || busy} onChange={(color) => onChange({ color })} />
          {changed && (
            <span className="flex items-center gap-1.5">
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={reset}>
                {t('Cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={viewOnly || busy || !valid}>
                {t('Save')}
              </Button>
            </span>
          )}
        </div>
      </form>
      <div className="flex flex-col gap-1.5 border-t border-(--line) pt-3">
        <span className="text-caption text-muted-foreground">
          {identity.isDefault
            ? t('Projects no rule picks use the default identity. Rules pick it from a folder or remote.')
            : t('Rules pick this identity for a project from its folder or remote.')}
        </span>
        <RuleEditor
          rules={identity.rules}
          suggested={snapshot.suggestions?.map((entry) => entry.rule) ?? []}
          disabled={viewOnly || busy}
          onChange={(rules) => onChange({ rules })}
        />
      </div>
    </SettingsCard>
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
      <div className="mb-2 flex items-start justify-between gap-4">
        <p className="m-0 max-w-[560px] text-caption text-muted-foreground">
          {t(
            'Accounts that belong together, such as work and personal. Each project acts as one, picked from its folder or remote: its threads, commits, pull requests and deploys use that identity’s accounts.',
          )}
        </p>
        <Button
          size="sm"
          variant="secondary"
          disabled={viewOnly || busy}
          onClick={() =>
            setAdding({
              name: identities.length ? '' : t('Personal'),
              author: identities[0]?.gitAuthor.name ?? snapshot.gitUser.name ?? '',
              email: identities.length ? '' : (snapshot.gitUser.email ?? ''),
            })
          }
        >
          <Plus size={13} />
          {t('Add identity')}
        </Button>
      </div>
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
          <div className="flex flex-col gap-2.5">
            <Field label={t('Name')}>
              <Input
                autoFocus
                placeholder={t('Work')}
                value={adding.name}
                maxLength={60}
                onChange={(e) => setAdding({ ...adding, name: e.target.value })}
              />
            </Field>
            <Field label={t('Commit author')}>
              <Input
                value={adding.author}
                maxLength={120}
                onChange={(e) => setAdding({ ...adding, author: e.target.value })}
              />
            </Field>
            <Field label={t('Commit email')}>
              <Input
                type="email"
                placeholder="you@company.com"
                value={adding.email}
                maxLength={200}
                onChange={(e) => setAdding({ ...adding, email: e.target.value })}
              />
            </Field>
            <p className="m-0 text-caption text-muted-foreground">
              {t('Add rules after it is created, such as the folder or remote of its projects.')}
            </p>
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
