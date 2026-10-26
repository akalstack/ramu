import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { ArchiveRestore, ChevronRight, Copy, Download, FileDiff, Trash2 } from 'lucide-react-native'
import type { GitCommitFile } from '@ramu/shared/types'
import { font, space, useTheme } from '../../../theme'
import { ago, useSay } from '../../../i18n'
import { useChat, useStore } from '../../../runtime/store'
import { isMethodMissing } from '../../../runtime/goalVerify'
import {
  filesMethod,
  readRevision,
  revisionFiles,
  revisionLetter,
  revisionParams,
  stashTitle,
} from '../../../runtime/gitRevision'
import { Header, HeaderButton, Screen, PageScrollView as ScrollView } from '../../../components/Screen'
import { Button, Card, Divider, Pill, SectionLabel, T, tap } from '../../../components/ui'

/**
 * One commit or stash from Source Control: what it is, the files it touched and a way into each file's diff, like the
 * desktop's expandable history rows. A stash can also be applied or popped from here once you have looked inside it.
 */
export default function Revision() {
  const say = useSay()
  const { c } = useTheme()
  const router = useRouter()
  const store = useStore()
  const params = useLocalSearchParams<{
    id: string
    repoId: string
    repoName?: string
    oid: string
    stash?: string
    subject?: string
    author?: string
    at?: string
    ref?: string
  }>()
  const chat = useChat(params.id)
  const revision = readRevision(params.oid, params.stash)
  const [files, setFiles] = useState<GitCommitFile[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  useEffect(() => {
    if (!chat || !revision || !params.repoId) return
    let alive = true
    setFiles(null)
    setError('')
    store.invoke(chat.computerId, filesMethod(revision), chat.taskId, params.repoId, revision.oid).then(
      (list) => alive && setFiles(list),
      (reason) =>
        alive &&
        setError(
          isMethodMissing(reason)
            ? say('This computer is too old to list the files in a commit. Update Ramu on it.')
            : reason instanceof Error
              ? reason.message
              : String(reason),
        ),
    )
    return () => {
      alive = false
    }
  }, [chat?.computerId, chat?.taskId, params.repoId, revision?.oid, revision?.stash])
  if (!chat || !revision || !params.repoId)
    return (
      <Screen bg="canvas">
        <Header title={say('Commit not found')} />
      </Screen>
    )
  const subject = params.subject ?? ''
  const rows = files ? revisionFiles(files) : []
  const at = Number(params.at)
  const open = (file: GitCommitFile) => {
    tap()
    router.push({
      pathname: '/chat/[id]/file',
      params: { id: chat.id, repoId: params.repoId, path: file.path, ...revisionParams(revision) },
    })
  }
  const act = (method: 'git.applyStash' | 'git.popStash' | 'git.dropStash', done: string) => {
    if (busy) return
    setBusy(true)
    setActionError('')
    store.invoke(chat.computerId, method, chat.taskId, params.repoId, revision.oid).then(
      () => router.back(),
      (reason) => {
        setBusy(false)
        const message = reason instanceof Error ? reason.message : String(reason)
        setActionError(message)
        Alert.alert(done, message)
      },
    )
  }
  return (
    <Screen bg="canvas">
      <Header
        title={revision.stash ? (params.ref ?? say('Stash')) : revision.oid.slice(0, 7)}
        subtitle={params.repoName}
        right={
          <HeaderButton
            icon={Copy}
            label={say(revision.stash ? 'Copy stash name' : 'Copy commit hash')}
            onPress={() => void Clipboard.setStringAsync(revision.stash ? (params.ref ?? revision.oid) : revision.oid)}
          />
        }
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.l, paddingTop: space.s, gap: space.l, paddingBottom: space.xl * 2 }}
      >
        <Card style={{ padding: space.l, gap: space.xs }}>
          <T size={font.heading} weight="600" copyable={subject}>
            {revision.stash ? stashTitle(subject) : subject}
          </T>
          <T size={font.control} tone="muted">
            {revision.stash
              ? say('Saved changes you can apply later')
              : [params.author, Number.isFinite(at) && at ? ago(at) : ''].filter(Boolean).join(' · ')}
          </T>
        </Card>
        {revision.stash ? (
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Button
              kind="secondary"
              icon={Download}
              title={say('Apply')}
              disabled={busy}
              style={{ flex: 1 }}
              onPress={() => act('git.applyStash', say('Could not apply stash'))}
            />
            <Button
              icon={ArchiveRestore}
              title={say('Pop')}
              disabled={busy}
              style={{ flex: 1 }}
              onPress={() => act('git.popStash', say('Could not pop stash'))}
            />
            <Button
              kind="danger"
              icon={Trash2}
              title={say('Delete')}
              disabled={busy}
              accessibilityLabel={say('Delete stash')}
              onPress={() =>
                Alert.alert(say('Delete stash?'), stashTitle(subject), [
                  { text: say('Cancel'), style: 'cancel' },
                  {
                    text: say('Delete'),
                    style: 'destructive',
                    onPress: () => act('git.dropStash', say('Could not delete stash')),
                  },
                ])
              }
            />
          </View>
        ) : null}
        {actionError ? (
          <T tone="bad" accessibilityLiveRegion="polite" style={{ paddingHorizontal: space.xs }}>
            {actionError}
          </T>
        ) : null}
        <View>
          <SectionLabel>
            {files
              ? say(rows.length === 1 ? '{count} file changed' : '{count} files changed', { count: rows.length })
              : say('Files')}
          </SectionLabel>
          {error ? (
            <T tone="bad" style={{ paddingHorizontal: space.l }}>
              {error}
            </T>
          ) : !files ? (
            <ActivityIndicator style={{ marginTop: space.l }} color={c.accent} />
          ) : rows.length ? (
            <Card>
              {rows.map((file, index) => {
                const { letter, tone } = revisionLetter(file.status)
                return (
                  <View key={file.path}>
                    {index ? <Divider inset={space.l} /> : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={say('Open changes in {path}', { path: file.path })}
                      onPress={() => open(file)}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.m,
                        paddingHorizontal: space.l,
                        paddingVertical: space.m,
                        minHeight: 52,
                        backgroundColor: pressed ? c.pressed : 'transparent',
                      })}
                    >
                      <FileDiff size={17} color={tone === 'ok' ? c.ok : tone === 'bad' ? c.bad : c.soft} />
                      <View style={{ flex: 1, gap: 1 }}>
                        <T size={font.body - 1} weight="500" numberOfLines={1}>
                          {file.name}
                        </T>
                        <T size={font.caption} tone="muted" numberOfLines={1}>
                          {file.origPath ? `${file.origPath} → ${file.dir}${file.name}` : file.dir || '/'}
                        </T>
                      </View>
                      <Pill tone={tone} wash={tone === 'ok' ? c.okWash : tone === 'bad' ? c.badWash : c.warnWash}>
                        {letter}
                      </Pill>
                      <ChevronRight size={16} color={c.muted} />
                    </Pressable>
                  </View>
                )
              })}
            </Card>
          ) : (
            <T tone="muted" style={{ paddingHorizontal: space.l }}>
              {say('This commit changed no files.')}
            </T>
          )}
        </View>
      </ScrollView>
    </Screen>
  )
}
