import type { ReactNode } from 'react'
import { Briefcase, CircleSlash, User } from 'lucide-react'
import { cn } from 'cn'
import type { IdentitySnapshot } from '@ramu/shared/identities'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { Badge } from '@/components/ui/badge'
import { t } from '../i18n'
import { IdentityDot } from '../settings/IdentityChip'
import { GitHubSignIn } from './SignInRows'
import {
  workDraft,
  type IdentityChoice,
  type IdentityDraft,
  type IdentityDrafts,
  type IdentityProblem,
} from './identitySetup'

const PROBLEMS: Record<IdentityProblem['field'], string> = {
  name: 'Give each identity its own name.',
  author: 'Add the name your commits show.',
  email: 'Use an email address for the Git author.',
  rule: 'Use a folder such as ~/work/** or a remote such as github.com/acme.',
}

function DraftCard({
  icon,
  title,
  badge,
  help,
  draft,
  rule,
  problem,
  action,
  onDraft,
}: {
  icon: ReactNode
  title: string
  badge?: string
  help: string
  draft: IdentityDraft
  rule: boolean
  problem: IdentityProblem['field'] | null
  action?: ReactNode
  onDraft(draft: IdentityDraft): void
}) {
  const field = (key: 'name' | 'author' | 'email' | 'rule', label: string, placeholder: string, maxLength: number) => (
    <Input
      aria-label={label}
      aria-invalid={problem === key || undefined}
      placeholder={placeholder}
      value={draft[key]}
      maxLength={maxLength}
      onChange={(event) => onDraft({ ...draft, [key]: event.target.value })}
    />
  )
  return (
    <section className="flex flex-col gap-2 rounded-(--radius-m) bg-fill p-3" aria-label={title}>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <strong className="font-medium">{title}</strong>
        {badge && (
          <Badge variant="secondary" className="font-normal">
            {badge}
          </Badge>
        )}
        <span className="flex-1" />
        {action}
      </div>
      <p className="m-0 text-caption text-muted-foreground">{help}</p>
      <div className="grid grid-cols-3 gap-1.5">
        {field('name', t('Name'), title, 60)}
        {field('author', t('Git author name'), t('Git author name'), 120)}
        {field('email', t('Git author email'), 'you@example.com', 200)}
      </div>
      {rule && field('rule', t('Rule that picks it'), '~/work/**  ·  github.com/acme', 500)}
      {problem && (
        <p role="alert" className="m-0 text-caption text-bad">
          {t(PROBLEMS[problem])}
        </p>
      )}
    </section>
  )
}

/**
 * Who this host commits as: Personal from its global Git user, and optionally Work, picked by a folder or a remote.
 * Nothing is created until the person continues; a host that already has identities just shows them. GitHub's sign-in
 * follows, since pull requests and issues act as the identity's account.
 */
export function IdentitiesStep({
  snapshot,
  error,
  drafts,
  problem,
  onDrafts,
}: {
  snapshot: IdentitySnapshot | null
  error: string
  drafts: IdentityDrafts | null
  problem: IdentityProblem | null
  onDrafts(drafts: IdentityDrafts): void
}) {
  if (error) return <p className="m-0 text-caption text-muted-foreground">{error}</p>
  if (!snapshot || !drafts)
    return (
      <p className="m-0 text-caption text-muted-foreground" role="status">
        {t('Reading your Git user…')}
      </p>
    )
  const { identities } = snapshot.settings
  if (identities.length)
    return (
      <div className="flex flex-col gap-3">
        <div className="overflow-hidden rounded-(--radius-m) bg-fill [&>*+*]:border-t [&>*+*]:border-(--line)">
          {identities.map((identity) => (
            <div key={identity.id} className="flex items-center gap-3 px-4 py-3">
              <IdentityDot color={identity.color} />
              <span className="min-w-0 flex-1">
                <strong className="flex items-center gap-2 font-medium">
                  {identity.name}
                  {identity.isDefault && (
                    <Badge variant="secondary" className="font-normal">
                      {t('Default')}
                    </Badge>
                  )}
                </strong>
                <span className="mt-0.5 block truncate text-caption text-muted-foreground">
                  {identity.gitAuthor.name} &lt;{identity.gitAuthor.email}&gt;
                </span>
              </span>
            </div>
          ))}
        </div>
        <p className="m-0 text-caption text-muted-foreground">
          {t('This host already has identities. Change them in Settings › Identities.')}
        </p>
        <GitHubSignIn />
      </div>
    )
  const noGitUser = !snapshot.gitUser.name && !snapshot.gitUser.email
  const choose = (choice: IdentityChoice) =>
    onDrafts({
      ...drafts,
      choice,
      work: choice === 'both' ? (drafts.work ?? workDraft(drafts.personal, t('Work'))) : drafts.work,
    })
  const options: { value: IdentityChoice; icon: ReactNode; title: string; help: string }[] = [
    {
      value: 'none',
      icon: <CircleSlash size={15} />,
      title: t('Not now'),
      help: t('Commits use your Git config as they do today. Add identities later in Settings.'),
    },
    {
      value: 'personal',
      icon: <User size={15} />,
      title: t('Personal only'),
      help: t('One identity for every project, with the author you choose.'),
    },
    {
      value: 'both',
      icon: <Briefcase size={15} />,
      title: t('Personal and Work'),
      help: t('Work projects, picked by folder or remote, commit with your work email and accounts.'),
    },
  ]
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label={t('Identities')} className="grid gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant="ghost"
            role="radio"
            aria-checked={drafts.choice === option.value}
            className={cn(
              'h-auto min-h-0 flex-col items-start gap-1 whitespace-normal rounded-(--radius-m) border border-(--line) bg-fill! p-3 text-left font-normal',
              drafts.choice === option.value && 'border-brand bg-hover!',
            )}
            onClick={() => choose(option.value)}
          >
            <span className="flex items-center gap-2 font-medium text-foreground">
              <span className="text-muted-foreground">{option.icon}</span>
              {option.title}
            </span>
            <span className="text-caption text-muted-foreground">{option.help}</span>
          </Button>
        ))}
      </div>
      {drafts.choice !== 'none' && (
        <DraftCard
          icon={<User size={15} />}
          title={drafts.personal.name || t('Personal')}
          badge={t('Default')}
          help={
            noGitUser
              ? t('Your Git config has no user yet. Fill in the name and email your commits should show.')
              : t('From your Git config. Projects no rule picks use it.')
          }
          draft={drafts.personal}
          rule={false}
          problem={problem?.which === 'personal' ? problem.field : null}
          onDraft={(personal) => onDrafts({ ...drafts, personal })}
        />
      )}
      {drafts.choice === 'both' && drafts.work && (
        <DraftCard
          icon={<Briefcase size={15} />}
          title={drafts.work.name || t('Work')}
          help={t('Projects in this folder or from this remote commit as Work, with its own accounts.')}
          draft={drafts.work}
          rule
          problem={problem?.which === 'work' ? problem.field : null}
          onDraft={(work) => onDrafts({ ...drafts, work })}
        />
      )}
      <GitHubSignIn />
    </div>
  )
}
