import type { LearningJob, ManagedSkill } from '@ramu/shared/types'
import { MarkdownText } from '../chat/MarkdownText'
import { Dialog } from '../Menu'
import { t, useLanguage } from '../i18n'
import { useLearningSnapshot } from './learningQueries'

type Proposal = {
  memories: { title: string; content: string; reason: string }[]
  skills: { id?: string; name: string; content: string; reason: string }[]
  archive: { id: string; absorbedInto: string; reason: string }[]
}

/** A stored proposal, or null when it cannot be read; missing lists read as empty. */
function readProposal(text: string | null): Proposal | null {
  if (!text) return null
  try {
    const value = JSON.parse(text) as Partial<Proposal>
    return {
      memories: Array.isArray(value.memories) ? value.memories : [],
      skills: Array.isArray(value.skills) ? value.skills : [],
      archive: Array.isArray(value.archive) ? value.archive : [],
    }
  } catch {
    return null
  }
}

/** Learned text is Markdown the model wrote; it reads as formatted text, not as raw headings and backticks. */
function ProposalText({ text }: { text: string }) {
  return <MarkdownText density="compact">{text}</MarkdownText>
}

/** Each note and skill a review would write, with the skill's earlier text beside it and why it was proposed. */
function ProposalChanges({ proposal, skills }: { proposal: Proposal; skills: ManagedSkill[] }) {
  const skillName = (id: string) => skills.find((entry) => entry.id === id)?.name ?? id
  return (
    <div className="flex flex-col gap-3 text-caption">
      {proposal.memories.map((note, index) => (
        <section key={`memory-${index}`}>
          <strong>
            {t('Memory')}: {note.title}
          </strong>
          <ProposalText text={note.content} />
          <p className="m-0 text-caption text-muted-foreground">{note.reason}</p>
        </section>
      ))}
      {proposal.skills.map((skill, index) => (
        <section key={`skill-${index}`}>
          <strong>
            {t('Skill')}: {skill.name}
          </strong>
          <div className="grid grid-cols-2 gap-2 text-caption">
            <div>
              <strong>{t('Earlier revision')}</strong>
              <pre className="whitespace-pre-wrap">
                {skills.find((entry) => entry.id === skill.id)?.content ?? t('No earlier text')}
              </pre>
            </div>
            <div>
              <strong>{t('Proposed revision')}</strong>
              <pre className="whitespace-pre-wrap">{skill.content}</pre>
            </div>
          </div>
          <p className="m-0 text-caption text-muted-foreground">{skill.reason}</p>
        </section>
      ))}
      {proposal.archive.map((item) => (
        <section key={item.id}>
          <strong>
            {t('Archive')}: {skillName(item.id)} → {skillName(item.absorbedInto)}
          </strong>
          <p className="m-0 text-caption">{item.reason}</p>
        </section>
      ))}
    </div>
  )
}

/**
 * What one review saved and what still waits for Apply. Saved items are listed by name, since the notes and skills
 * themselves live in Memory and Customize → Skills and may have changed since.
 */
export function LearningDetailsDialog({ host, job, onClose }: { host: string; job: LearningJob; onClose: () => void }) {
  useLanguage()
  const skills = useLearningSnapshot(host)?.skills ?? []
  const proposal = readProposal(job.proposal)
  const saved = job.changes
  const waiting = job.status === 'pending'
  const hasSaved = !!saved && saved.memories.length + saved.skills.length > 0
  return (
    <Dialog
      title={job.sessionTitle ?? t('What Ramu learned')}
      confirmLabel={t('Done')}
      cancellable={false}
      onConfirm={onClose}
      onCancel={onClose}
    >
      <div className="dialog-wide flex min-w-0 flex-col gap-4">
        {hasSaved && (
          <section className="flex flex-col gap-1.5">
            <h4 className="m-0 text-control font-medium">
              {job.status === 'undone' ? t('Saved, then undone') : t('Saved')}
            </h4>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-caption">
              {saved.memories.map((note) => (
                <li key={`memory-${note.id}`}>
                  {t('Memory')}: {note.title}
                  <span className="text-muted-foreground">
                    {' · '}
                    {note.action === 'added' ? t('Added') : t('Updated')}
                  </span>
                </li>
              ))}
              {saved.skills.map((skill) => (
                <li key={`skill-${skill.id}`}>
                  {t('Skill')}: {skill.name}
                  <span className="text-muted-foreground">
                    {' · '}
                    {skill.before === null ? t('Added') : t('Updated')}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {proposal && proposal.memories.length + proposal.skills.length + proposal.archive.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <h4 className="m-0 text-control font-medium">{waiting ? t('Waiting for you') : t('What it wrote')}</h4>
            <ProposalChanges proposal={proposal} skills={skills} />
          </section>
        )}
        {!hasSaved && !proposal && <p className="m-0 text-caption text-muted-foreground">{t('Nothing to show.')}</p>}
      </div>
    </Dialog>
  )
}
