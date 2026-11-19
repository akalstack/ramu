import { useEffect, useState } from 'react'
import { Alert, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Check, FolderOpen } from 'lucide-react-native'
import type { ArtifactInfo } from '@ramu/shared/artifacts'
import { PROJECT_NAME } from '@ramu/shared/stacks'
import { folderName, isProjectFolder, titleFolderName } from '@ramu/shared/workspace/hostFolders'
import { useSay } from '../i18n'
import { pickFolder } from '../runtime/folderPick'
import { useStore } from '../runtime/store'
import { font, space, useTheme } from '../theme'
import { TextField } from './ScheduleFields'
import { Button, Card, Row, SHEET_SETTLE_MS, Segmented, Sheet, SheetScrollView, T, Toggle } from './ui'

/**
 * The phone's Make it a project, as on the desktop: the artifact's sources and records go into a folder of one of the
 * host's projects (its own first), or into a new project folder wherever the person puts it, and a thread builds it.
 */
export function MakeProjectSheet({
  open,
  onClose,
  page,
  computerId,
}: {
  open: boolean
  onClose: () => void
  page: ArtifactInfo
  computerId: string
}) {
  const say = useSay()
  const store = useStore()
  const router = useRouter()
  const { c } = useTheme()
  const projects = store.projects.filter((project) => project.computerId === computerId && project.root)
  const own = projects.some((project) => project.id === page.projectId) ? page.projectId : null
  const [mode, setMode] = useState<'project' | 'new'>(own ? 'project' : 'new')
  const [projectId, setProjectId] = useState(own ?? projects[0]?.id ?? '')
  const [name, setName] = useState(() => titleFolderName(page.title))
  const [startThread, setStartThread] = useState(true)
  const [parent, setParent] = useState<{ path: string; chosen: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  // The sheet steps aside while the folder browser chooses where the project goes, then comes back as it was.
  const [picking, setPicking] = useState(false)
  useEffect(() => {
    if (!open || parent) return
    void store.invoke(computerId, 'projects.defaultParent').then(
      (path) => setParent((current) => current ?? { path, chosen: false }),
      () => {},
    )
  }, [open, parent, computerId, store])
  const folder = name.trim()
  const valid = mode === 'project' ? !!projectId && isProjectFolder(folder) : PROJECT_NAME.test(folder)
  const changeParent = () => {
    setPicking(true)
    setTimeout(() => {
      void pickFolder(() =>
        router.push({
          pathname: '/folders',
          params: { purpose: 'parent', computer: computerId, ...(parent ? { start: parent.path } : {}) },
        }),
      ).then((path) => {
        if (path) setParent({ path, chosen: true })
        setPicking(false)
      })
    }, SHEET_SETTLE_MS)
  }
  const confirm = async () => {
    setBusy(true)
    try {
      const made = await store.invoke(
        computerId,
        'artifacts.makeProject',
        page.id,
        mode === 'project'
          ? { kind: 'project', projectId, folder, startThread }
          : { kind: 'new', name: folder, ...(parent?.chosen ? { parent: parent.path } : {}) },
      )
      await store.refresh(computerId).catch(() => {})
      onClose()
      if (made.thread)
        router.push({ pathname: '/chat/[id]', params: { id: store.resolveChat(computerId, made.thread.taskId) } })
      else Alert.alert(say('Exported to {0}', { 0: made.folder }))
    } catch (failure) {
      Alert.alert(say('That didn’t work'), failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open={open && !picking} onClose={() => !busy && !picking && onClose()} title={say('Make it a project?')}>
      <SheetScrollView contentContainerStyle={{ padding: space.l, gap: space.m }}>
        <T size={font.control} tone="muted">
          {page.capabilities.records || page.capabilities.ai
            ? say(
                'This artifact keeps records or uses a model on this host, so it cannot go on the web as is. A project can have its own database and server.',
              )
            : say('A project can have a backend, more files, sign-in and its own domain.')}
        </T>
        {projects.length ? (
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { key: 'project', label: say('Into a project') },
              { key: 'new', label: say('New project') },
            ]}
          />
        ) : null}
        {mode === 'project' ? (
          <Card>
            {projects.map((project) => (
              <Row key={project.id} onPress={() => setProjectId(project.id)}>
                <T style={{ flex: 1 }} numberOfLines={1}>
                  {project.name}
                </T>
                {project.id === projectId ? <Check size={16} color={c.accent} /> : null}
              </Row>
            ))}
          </Card>
        ) : null}
        <T size={font.caption} tone="muted">
          {mode === 'project' ? say('Folder in the project') : say('Project name')}
        </T>
        <TextField value={name} onChangeText={setName} maxLength={mode === 'project' ? 400 : 100} />
        {mode === 'new' ? (
          <Row onPress={changeParent} disabled={busy} accessibilityLabel={say('Change where the project goes')}>
            <FolderOpen size={16} color={c.soft} />
            <View style={{ flex: 1 }}>
              <T numberOfLines={1}>
                {parent ? say('In {0}', { 0: folderName(parent.path) }) : say('In the usual folder')}
              </T>
              {parent ? (
                <T size={font.caption} tone="muted" numberOfLines={1} ellipsizeMode="head">
                  {parent.path}
                </T>
              ) : null}
            </View>
            <T tone="accent">{say('Change…')}</T>
          </Row>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <T style={{ flex: 1 }}>{say('Start a thread there to build it into the project')}</T>
            <Toggle
              value={startThread}
              onValueChange={setStartThread}
              accessibilityLabel={say('Start a thread there to build it into the project')}
            />
          </View>
        )}
        <T size={font.caption} tone="muted">
          {mode === 'project'
            ? say(
                'Ramu writes the artifact’s sources and records to this folder in the project. A folder that already holds files is kept, and a numbered one is used instead.',
              )
            : say(
                'Ramu writes the artifact’s sources and records to a new folder, adds it to your projects and starts a thread there to turn it into an app.',
              )}
        </T>
        <Button
          title={mode === 'project' && !startThread ? say('Export') : say('Make it a project')}
          disabled={busy || !valid}
          onPress={() => void confirm()}
        />
      </SheetScrollView>
    </Sheet>
  )
}
