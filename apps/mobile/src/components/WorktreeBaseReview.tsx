import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import type { WorktreePlanEntry } from '@ramu/shared/types'
import { useStore, type OutboxItem } from '../runtime/store'
import { useT } from '../i18n'
import { space } from '../theme'
import { Button, Sheet, T } from './ui'

/** Only confirmed pre-allocation rejections enter this flow. Uncertain sends cannot replace their plan. */
export function WorktreeBaseReview({ item, onClose }: { item: OutboxItem; onClose: () => void }) {
  const store = useStore()
  const t = useT()
  const online = store.isOnline(item.computerId)
  const [plan, setPlan] = useState<WorktreePlanEntry[] | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  const generation = useRef(0)
  const latest = useRef(store)
  latest.current = store
  useEffect(() => {
    const token = ++generation.current
    setPlan(null)
    setError('')
    if (online)
      void latest.current.previewOutbox(item.id).then(
        (value) => {
          if (generation.current === token) setPlan(value)
        },
        (reason) => {
          if (generation.current === token) setError(reason instanceof Error ? reason.message : String(reason))
        },
      )
    return () => {
      generation.current = token + 1
    }
  }, [item.id, online])
  const save = async () => {
    if (!online || !plan || pending.current) return
    pending.current = true
    setSaving(true)
    setError('')
    const token = generation.current
    try {
      await latest.current.resumeOutbox(item.id, plan)
      if (generation.current === token) onClose()
    } catch (reason) {
      if (generation.current === token) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      pending.current = false
      if (generation.current === token) setSaving(false)
    }
  }
  return (
    <Sheet
      open
      title={t.branchReviewBases}
      onClose={() => {
        if (!pending.current) onClose()
      }}
    >
      <View style={{ paddingHorizontal: space.l, gap: space.m }}>
        <T>{t.branchReviewHint}</T>
        {!online ? <T tone="muted">{t.branchNameOffline}</T> : !plan && !error ? <T>{t.branchReviewLoading}</T> : null}
        {plan?.map((entry) => (
          <View key={entry.repoId}>
            <T weight="500">
              {entry.repoName}: {entry.taskBranch}
            </T>
            <T tone="muted">
              {entry.baseRef} · {item.reviewedPlan?.find((old) => old.repoId === entry.repoId)?.baseOid?.slice(0, 12)} →{' '}
              {entry.baseOid?.slice(0, 12)}
            </T>
            <T tone="muted" selectable>
              {entry.path}
            </T>
          </View>
        ))}
        {error ? (
          <T tone="bad" accessibilityRole="alert">
            {error}
          </T>
        ) : null}
        <Button
          title={t.branchRetryBases}
          disabled={!online || !plan?.length || plan.some((entry) => !entry.baseOid) || saving}
          onPress={() => void save()}
        />
        <Button title={t.cancel} kind="ghost" disabled={saving} onPress={onClose} />
      </View>
    </Sheet>
  )
}
