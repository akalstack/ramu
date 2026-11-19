import { useEffect, useState } from 'react'
import { ActivityIndicator, TextInput, View } from 'react-native'
import type { PullRequestInput } from '@ramu/shared/types'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { Button, Sheet, T, Toggle } from './ui'

/**
 * Opens a pull request from the phone, as the desktop's Create pull request does: the title and description are drafted
 * from the branch's commits (closing the issue its thread started from) and stay editable before anything is pushed.
 * Confirming publishes the branch if it is not on the remote yet, or moves commits on the base branch to a new one.
 */
export function CreatePullRequest({
  computerId,
  taskId,
  repoId,
  open,
  onClose,
  onCreated,
}: {
  computerId: string
  taskId: string
  repoId: string
  open: boolean
  onClose(): void
  onCreated(): void
}) {
  const store = useStore()
  const say = useSay()
  const { c } = useTheme()
  const [input, setInput] = useState<PullRequestInput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setInput(null)
    setError(null)
    store.invoke(computerId, 'forge.pullRequestDraft', taskId, repoId).then(
      (draft) => {
        if (!cancelled)
          setInput({
            title: draft.title,
            body: draft.body,
            base: draft.base,
            draft: false,
            ...(draft.branch ? { branch: draft.branch } : {}),
          })
      },
      (reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      },
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drafts again each time the sheet opens
  }, [open, computerId, taskId, repoId])
  const create = async () => {
    if (!input || busy) return
    setBusy(true)
    setError(null)
    try {
      await store.invoke(computerId, 'forge.createPullRequest', taskId, repoId, input)
      onCreated()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }
  const field = {
    color: c.text,
    fontSize: font.body,
    padding: space.m,
    borderRadius: radius.m,
    backgroundColor: c.raised2,
  }
  return (
    <Sheet open={open} onClose={onClose} title={say('Create pull request')}>
      <View style={{ padding: space.l, gap: space.m }}>
        {!input && !error ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <ActivityIndicator color={c.accent} />
            <T tone="muted">{say('Writing the title and description from your commits…')}</T>
          </View>
        ) : null}
        {input ? (
          <>
            <T size={font.caption} tone="muted">
              {input.branch !== undefined
                ? say(
                    'Into {0}. Your commits move to a new branch, which is published first. {0} itself is not changed.',
                    {
                      0: input.base,
                    },
                  )
                : say('Into {0}. The branch is published first if it is not on the remote yet.', { 0: input.base })}
            </T>
            {input.branch !== undefined ? (
              <View style={{ gap: space.xs }}>
                <T size={font.caption} tone="muted">
                  {say('New branch')}
                </T>
                <TextInput
                  editable={!busy}
                  value={input.branch}
                  maxLength={200}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={(branch) => setInput({ ...input, branch })}
                  style={field}
                />
              </View>
            ) : null}
            <View style={{ gap: space.xs }}>
              <T size={font.caption} tone="muted">
                {say('Title')}
              </T>
              <TextInput
                editable={!busy}
                value={input.title}
                maxLength={500}
                onChangeText={(title) => setInput({ ...input, title })}
                style={field}
              />
            </View>
            <View style={{ gap: space.xs }}>
              <T size={font.caption} tone="muted">
                {say('Description')}
              </T>
              <TextInput
                editable={!busy}
                value={input.body}
                maxLength={100_000}
                multiline
                onChangeText={(body) => setInput({ ...input, body })}
                style={[field, { minHeight: 160, textAlignVertical: 'top' }]}
              />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
              <T style={{ flex: 1 }}>{say('Open as draft')}</T>
              <Toggle
                accessibilityLabel={say('Open as draft')}
                value={input.draft}
                disabled={busy}
                onValueChange={(draft) => setInput({ ...input, draft })}
              />
            </View>
          </>
        ) : null}
        {error ? <T tone="bad">{error}</T> : null}
        <Button
          title={busy ? say('Creating…') : say('Create pull request')}
          disabled={busy || !input || !input.title.trim() || (input.branch !== undefined && !input.branch.trim())}
          onPress={() => void create()}
        />
      </View>
    </Sheet>
  )
}
