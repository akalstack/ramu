import { useEffect, useRef, useState } from 'react'
import { TextInput, View } from 'react-native'
import type { RamuMethods } from '@ramu/shared/api'
import type { WorktreePlanEntry } from '@ramu/shared/types'
import { validBranchName, type BranchChoice, type BranchNamingIntent } from '@ramu/shared/workspaceDefaults'
import { useStore } from '../runtime/store'
import { isMethodMissing } from '../runtime/goalVerify'
import { useT } from '../i18n'
import { font, radius, space, useTheme } from '../theme'
import { Button, T } from './ui'

// Correlation only, never a credential. Native runtimes do not all expose crypto.randomUUID.
const requestId = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (part) => {
    const n = Math.floor(Math.random() * 16)
    return (part === 'x' ? n : (n & 3) | 8).toString(16)
  })

/** Optional details in the existing workspace picker. Neither action allocates a thread or worktree. */
export function BranchNameControls({
  host,
  projectId,
  title,
  intent,
  branchPrefix,
  choice,
  online,
  onChange,
  onReview,
}: {
  host: string
  projectId: string
  title: string
  intent: BranchNamingIntent
  branchPrefix: string
  choice?: BranchChoice
  online: boolean
  onChange: (choice?: BranchChoice) => void
  onReview: (plan: WorktreePlanEntry[]) => void
}) {
  const { c } = useTheme()
  const t = useT()
  const store = useStore()
  const latest = useRef(store)
  latest.current = store
  const [busy, setBusy] = useState<'generate' | 'preview' | null>(null)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ key: string; rows: WorktreePlanEntry[] } | null>(null)
  const running = useRef(false)
  const epoch = useRef(0)
  const pending = useRef<{ host: string; id: string } | null>(null)
  const inputKey = JSON.stringify([host, projectId, title, intent, branchPrefix, choice, online])
  const plan = preview?.key === inputKey ? preview.rows : null
  // Invalidate during render, before effect cleanup, so an old response cannot win a scope switch.
  const scope = useRef(inputKey)
  if (scope.current !== inputKey) {
    scope.current = inputKey
    epoch.current++
  }
  const cancel = () => {
    epoch.current++
    running.current = false
    const request = pending.current
    pending.current = null
    if (request) void latest.current.invoke(request.host, 'tasks.cancelBranch', request.id).catch(() => {})
  }
  useEffect(() => {
    cancel()
    setBusy(null)
    setError('')
    setPreview(null)
    return cancel
    // Cancellation uses refs so it stays bound to the host that owns the request.
  }, [inputKey])
  const invalid = !!choice && !validBranchName(choice.name)
  const run = async (action: 'generate' | 'preview') => {
    if (!online || running.current || !title.trim() || (action === 'preview' && invalid)) return
    cancel()
    running.current = true
    const token = epoch.current
    const key = inputKey
    setBusy(action)
    setError('')
    setPreview(null)
    const active = () => token === epoch.current && scope.current === key
    try {
      if (action === 'generate') {
        const id = requestId()
        pending.current = { host, id }
        const result = await latest.current.invoke(host, 'tasks.generateBranch', projectId, title, intent, id)
        if (active()) {
          if (!validBranchName(result.name) || result.name.length > 160) throw new Error(t.branchNameInvalid)
          onChange(result)
        }
      } else {
        const repos = await latest.current.invoke(host, 'repos.list', projectId)
        if (!active()) return
        const args: Parameters<RamuMethods['tasks.plan']> = [
          projectId,
          title,
          repos.map((repo) => repo.id),
          choice,
          { branchPrefix, strategy: intent.strategy },
        ]
        const result = await latest.current.invoke(host, 'tasks.plan', ...args)
        if (active()) setPreview({ key, rows: result })
      }
    } catch (reason) {
      if (active())
        setError(
          isMethodMissing(reason) ? t.branchNameOutdated : reason instanceof Error ? reason.message : String(reason),
        )
    } finally {
      if (active()) {
        pending.current = null
        running.current = false
        setBusy(null)
      }
    }
  }
  return (
    <View style={{ paddingHorizontal: space.l, gap: space.m }}>
      <T weight="500">{t.branchName}</T>
      <TextInput
        value={choice?.name ?? ''}
        maxLength={160}
        accessibilityLabel={t.branchName}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={t.branchNameAutomatic}
        placeholderTextColor={c.placeholder}
        onChangeText={(name) => {
          cancel()
          setBusy(null)
          setPreview(null)
          setError('')
          onChange(name ? { name, source: 'manual' } : undefined)
        }}
        style={{
          color: c.text,
          backgroundColor: c.raised2,
          borderRadius: radius.m,
          padding: space.m,
          fontSize: font.body,
          minHeight: 46,
        }}
      />
      {invalid ? (
        <T tone="bad" accessibilityRole="alert">
          {t.branchNameInvalid}
        </T>
      ) : null}
      {choice?.source === 'fallback' ? <T tone="muted">{t.branchNameFallback}</T> : null}
      {!online ? <T tone="muted">{t.branchNameOffline}</T> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.m }}>
        {intent.strategy !== 'fixed' ? (
          <Button
            title={t.branchNameGenerate}
            disabled={!online || !!busy || !title.trim()}
            onPress={() => void run('generate')}
          />
        ) : null}
        <Button
          title={t.branchNamePreview}
          kind="ghost"
          disabled={!online || !!busy || invalid || !title.trim()}
          onPress={() => void run('preview')}
        />
        {busy ? (
          <Button
            title={t.cancel}
            kind="ghost"
            onPress={() => {
              cancel()
              setBusy(null)
            }}
          />
        ) : null}
      </View>
      {error ? (
        <T tone="bad" accessibilityRole="alert">
          {error}
        </T>
      ) : null}
      {plan ? (
        <View style={{ gap: space.s }}>
          <T tone="muted">{t.branchNameProvisional}</T>
          <Button
            title={t.branchKeepBases}
            disabled={!plan.length || plan.some((entry) => !entry.baseOid)}
            onPress={() => {
              if (scope.current === inputKey) onReview(plan.map((entry) => ({ ...entry })))
            }}
          />
          {plan.map((entry) => (
            <View key={entry.repoId}>
              <T weight="500">
                {entry.repoName}: {entry.taskBranch}
              </T>
              <T tone="muted">
                {entry.baseRef} · {entry.baseOid?.slice(0, 12)}
              </T>
              <T tone="muted" selectable>
                {entry.path}
              </T>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}
