import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import type { ManagedSkill, Project } from '@ramu/shared/types'
import { providerName } from '@ramu/shared/providers/providers'
import { SKILL_ACTION_LABELS, skillActions } from '@ramu/shared/skillControls'
import { Button } from '@/components/desktop-button'
import { Badge } from '@/components/ui/badge'
import { Dialog } from '../Menu'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'

/** A skill Ramu wrote from a finished thread, as opposed to one the person wrote or installed. */
export const learnedByRamu = (skill: ManagedSkill) =>
  !skill.installation && !(skill.changedBy === 'user' && !skill.sourceSessionId)

export const LEARNED_STATUSES = ['active', 'disabled', 'archived', 'all'] as const
export type LearnedStatus = (typeof LEARNED_STATUSES)[number]
export const LEARNED_STATUS_LABELS: Record<LearnedStatus, string> = {
  active: 'Active',
  disabled: 'Disabled',
  archived: 'Archived',
  all: 'All',
}

type Act = (key: string, work: () => Promise<unknown>) => Promise<unknown>

/** Every saved revision of a skill, newest first, each with a way back to it. */
export function SkillHistory({ skill, busy, act }: { skill: ManagedSkill; busy: string | null; act: Act }) {
  useLanguage()
  const { invoke } = useHost()
  const [revisions, setRevisions] = useState<ManagedSkill[] | null>(null)
  if (!revisions)
    return (
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        disabled={busy !== null}
        onClick={() => void act('history', async () => setRevisions(await invoke('learning.history', skill.id)))}
      >
        {t('History')}
      </Button>
    )
  return (
    <div className="flex flex-col gap-1.5 text-caption">
      {revisions.map((revision) => (
        <details key={revision.revision}>
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {t('Revision {0}', { 0: revision.revision })}
          </summary>
          <pre className="m-0 mt-1 whitespace-pre-wrap text-caption">{revision.content}</pre>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null || revision.revision === skill.revision}
            onClick={() =>
              void act('revert', async () => {
                await invoke('learning.revert', skill.id, revision.revision)
                setRevisions(await invoke('learning.history', skill.id))
              })
            }
          >
            {t('Restore revision')}
          </Button>
        </details>
      ))}
    </div>
  )
}

/**
 * A skill Ramu learned: where it applies, how often agents read it, what it tells them, and pin, turn off, archive or
 * restore, with its history. Pinning keeps learning from rewriting it.
 */
export function LearnedSkillDetail({
  skill,
  projects,
  busy,
  act,
  onClose,
}: {
  skill: ManagedSkill
  projects: Project[]
  busy: string | null
  act: Act
  onClose: () => void
}) {
  useLanguage()
  const { invoke } = useHost()
  const [showText, setShowText] = useState(false)
  return (
    <Dialog title={skill.name} confirmLabel={t('Done')} cancellable={false} onConfirm={onClose} onCancel={onClose}>
      <div className="flex min-w-0 flex-col gap-3">
        {skill.description && <p className="m-0 text-control text-soft">{skill.description}</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" title={t('Where agents can load it')}>
            {skill.projectId
              ? (projects.find((project) => project.id === skill.projectId)?.name ?? t('One project'))
              : t('All projects')}
          </Badge>
          {skill.providers?.length ? (
            <Badge variant="outline">{skill.providers.map((provider) => providerName(provider)).join(', ')}</Badge>
          ) : null}
          {skill.status !== 'active' && <Badge variant="secondary">{t(skill.status)}</Badge>}
          {skill.pinned && <Badge variant="outline">{t('Pinned')}</Badge>}
          <span className="text-caption text-muted-foreground">{t('Read {0} times', { 0: skill.useCount })}</span>
        </div>
        {showText ? (
          <pre className="m-0 max-h-72 overflow-auto whitespace-pre-wrap text-caption text-muted-foreground">
            {skill.content}
          </pre>
        ) : (
          <Button size="sm" variant="ghost" className="self-start" onClick={() => setShowText(true)}>
            <BookOpen size={13} />
            {t('Show what it tells agents')}
          </Button>
        )}
        <div className="flex flex-wrap gap-1.5">
          {skillActions(skill).map((action) => (
            <Button
              key={action}
              size="sm"
              variant={action === 'pin' || action === 'restore' ? 'secondary' : 'ghost'}
              disabled={busy !== null}
              onClick={() => void act(action, () => invoke('learning.control', skill.id, action))}
            >
              {t(SKILL_ACTION_LABELS[action])}
            </Button>
          ))}
        </div>
        <SkillHistory skill={skill} busy={busy} act={act} />
      </div>
    </Dialog>
  )
}
