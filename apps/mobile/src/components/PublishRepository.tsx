import { useEffect, useState } from 'react'
import { TextInput, View } from 'react-native'
import type { ForgeRepositoryAccount } from '@ramu/shared/types'
import { GITHUB_REPOSITORY_NAME, githubNameFor } from '@ramu/shared/githubRepositoryName'
import { useStore } from '../runtime/store'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { Button, Card, Sheet, T, Toggle, tap } from './ui'

/**
 * A repository with no remote yet: create it on GitHub (private by default), add it as origin and push the current
 * branch, as Publish to GitHub does on the desktop.
 */
export function PublishRepository({
  computerId,
  taskId,
  repoId,
  repoName,
  readOnly,
  onPublished,
  onError,
}: {
  computerId: string
  taskId: string
  repoId: string
  repoName: string
  readOnly: boolean
  onPublished: () => void
  onError: (text: string) => void
}) {
  const store = useStore()
  const say = useSay()
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(githubNameFor(repoName))
  const [isPrivate, setPrivate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [account, setAccount] = useState<ForgeRepositoryAccount | null>(null)
  const online = store.isOnline(computerId)
  useEffect(() => {
    if (!open || !online) return
    let live = true
    store.invoke(computerId, 'forge.repositoryAccount', taskId, repoId).then(
      (next) => live && setAccount(next),
      () => live && setAccount(null),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `store` changes identity on every update; asked once per opening
  }, [open, online, computerId, taskId, repoId])
  const publish = async () => {
    setBusy(true)
    setError('')
    try {
      await store.invoke(computerId, 'forge.publishRepository', taskId, repoId, {
        name: name.trim(),
        visibility: isPrivate ? 'private' : 'public',
      })
      setOpen(false)
      onPublished()
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : String(reason)
      setError(text)
      onError(text)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Card style={{ padding: space.m, gap: space.s }}>
        <T weight="600">{say('Publish to GitHub')}</T>
        <T size={font.control} tone="muted">
          {say('This repository has no remote yet. Create it on GitHub and push this branch.')}
        </T>
        <Button
          kind="secondary"
          title={say('Publish to GitHub')}
          disabled={readOnly || !online}
          onPress={() => {
            tap()
            setOpen(true)
          }}
        />
      </Card>
      <Sheet open={open} onClose={() => !busy && setOpen(false)} title={say('Publish to GitHub')}>
        <View style={{ paddingHorizontal: space.l, gap: space.m }}>
          <T size={font.control} tone="muted">
            {account?.ambiguous
              ? say('Several GitHub accounts are saved. Choose one in Settings before publishing.')
              : account?.login
                ? say('Publishing as {0}', { 0: account.login })
                : say('Publishing with the GitHub CLI sign-in on this host.')}
          </T>
          <View style={{ gap: space.xs }}>
            <T size={font.caption} tone="muted">
              {say('Repository name')}
            </T>
            <TextInput
              accessibilityLabel={say('Repository name')}
              value={name}
              onChangeText={setName}
              maxLength={140}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              style={{ color: c.text, backgroundColor: c.fill, padding: space.m, borderRadius: radius.m }}
            />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <T>{say('Private repository')}</T>
            <Toggle
              value={isPrivate}
              onValueChange={setPrivate}
              disabled={busy}
              accessibilityLabel={say('Private repository')}
            />
          </View>
          <T size={font.caption} tone="muted">
            {say('Remote name: origin. Pushes the current branch and sets it to track the new repository.')}
          </T>
          {error ? <T tone="bad">{error}</T> : null}
          <Button
            title={busy ? say('Publishing…') : say('Publish to GitHub')}
            disabled={busy || !GITHUB_REPOSITORY_NAME.test(name.trim()) || account?.ambiguous === true}
            onPress={() => void publish()}
          />
        </View>
      </Sheet>
    </>
  )
}
