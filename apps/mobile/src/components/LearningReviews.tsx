import { useCallback, useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import type { LearningJob, LearningSnapshot } from '@ramu/shared/types'
import { font, space } from '../theme'
import { useStore } from '../runtime/store'
import { useSay } from '../i18n'
import { showToast } from '../runtime/toast'
import { Card, Divider, SectionLabel, T, tap } from './ui'

interface Proposal {
  memories?: { title: string; reason: string }[]
  skills?: { name: string; reason: string }[]
  archive?: { id: string; reason: string }[]
}

/** What a review would change, one line each, from its proposal; an unreadable one shows nothing rather than failing. */
function proposalLines(job: LearningJob, say: (text: string) => string): string[] {
  if (!job.proposal) return []
  try {
    const change = JSON.parse(job.proposal) as Proposal
    return [
      ...(change.memories ?? []).map((note) => `${say('Memory')}: ${note.title} — ${note.reason}`),
      ...(change.skills ?? []).map((skill) => `${say('Procedure')}: ${skill.name} — ${skill.reason}`),
      ...(change.archive ?? []).map((item) => `${say('Archive')}: ${item.id} — ${item.reason}`),
    ]
  } catch {
    return []
  }
}

/**
 * The learning reviews that wait for the person, as the desktop's Learning & skills lists them: what each would save
 * or change, with Apply, Retry review and Dismiss, so an agent's proposal does not wait until they are back at the
 * computer. Applied and dismissed reviews stay on the desktop's full list.
 */
export function LearningReviews({ hostId, locked }: { hostId: string; locked: boolean }) {
  const store = useStore()
  const say = useSay()
  const [jobs, setJobs] = useState<LearningJob[] | null>(null)
  const [busy, setBusy] = useState(false)
  const online = store.isOnline(hostId)
  const viewer = store.computers.find((computer) => computer.id === hostId)?.access === 'viewer'
  const load = useCallback(() => {
    void store
      .invoke(hostId, 'learning.get')
      .then((snapshot: LearningSnapshot) =>
        setJobs(
          snapshot.jobs.filter((job) => job.status === 'pending' || job.status === 'failed' || job.status === 'queued'),
        ),
      )
      .catch(() => setJobs(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store.invoke is stable; reloads when the host or its connection changes
  }, [hostId])
  useEffect(() => {
    if (online && !viewer) load()
  }, [online, viewer, load])
  if (!online || viewer || !jobs?.length) return null
  const act = (method: 'learning.apply' | 'learning.retry' | 'learning.dismiss', id: string) => {
    if (busy || locked) return
    tap()
    setBusy(true)
    void store
      .invoke(hostId, method, id)
      .then(load)
      .catch((error: unknown) => showToast(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false))
  }
  const action = (
    label: string,
    method: Parameters<typeof act>[0],
    id: string,
    tone: 'accent' | 'muted' = 'accent',
  ) => (
    <Pressable accessibilityRole="button" disabled={busy || locked} hitSlop={8} onPress={() => act(method, id)}>
      <T size={font.caption} weight="600" tone={busy || locked ? 'muted' : tone}>
        {label}
      </T>
    </Pressable>
  )
  return (
    <>
      <SectionLabel>{say('Learning review')}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        {jobs.map((job, index) => (
          <View key={job.id}>
            {index ? <Divider inset={space.m} /> : null}
            <View style={{ padding: space.m, gap: space.xs }}>
              <T weight="500">
                {job.sessionTitle ?? say('Thread')} · {say(job.status)}
              </T>
              <T size={font.caption} tone="muted">
                {new Date(job.createdAt).toLocaleString()}
              </T>
              {job.error ? (
                <T size={font.caption} tone="bad">
                  {job.error}
                </T>
              ) : null}
              {proposalLines(job, say).map((line) => (
                <T key={line} size={font.caption} numberOfLines={3}>
                  {line}
                </T>
              ))}
              <View style={{ flexDirection: 'row', gap: space.l, paddingTop: space.xs }}>
                {job.status === 'pending' ? action(say('Apply'), 'learning.apply', job.id) : null}
                {job.status === 'pending' || job.status === 'failed'
                  ? action(say('Retry review'), 'learning.retry', job.id, 'muted')
                  : null}
                {action(say('Dismiss'), 'learning.dismiss', job.id, 'muted')}
              </View>
            </View>
          </View>
        ))}
      </Card>
    </>
  )
}
