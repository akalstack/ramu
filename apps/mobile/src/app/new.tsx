import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Alert, Platform, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Check, ChevronDown, Folder, FolderGit2, GitBranch, MessageCircle, Monitor } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { STANDALONE } from '../runtime/types'
import { useT } from '../i18n'
import { Header, Screen, useSheetKeyboardOffset, PageScrollView as ScrollView } from '../components/Screen'
import { Composer, type ModelChoice } from '../components/Composer'
import { Row, Sheet, T, tap } from '../components/ui'

function TrayButton({ icon: I, label, onPress, prompt }: { icon: typeof Folder; label: string; onPress: () => void; prompt?: boolean }) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={() => {
        tap()
        onPress()
      }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: space.s + 2, borderRadius: radius.s, backgroundColor: pressed ? c.pressed : prompt ? c.accentWash : 'transparent' })}
    >
      <I size={14} color={prompt ? c.accent : c.soft} strokeWidth={1.8} />
      <T size={font.control} weight="500" tone={prompt ? 'accent' : 'soft'} numberOfLines={1}>
        {label}
      </T>
      <ChevronDown size={13} color={c.muted} />
    </Pressable>
  )
}

export default function NewChat() {
  const keyboardOffset = useSheetKeyboardOffset()
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { projects, selected, computers, createChat, isOnline } = useStore()
  const offline = !isOnline(selected)
  const list = projects.filter((p) => p.computerId === selected)
  // A chat runs in a project's folders, so the project is chosen first rather than defaulted.
  const [projectId, setProjectId] = useState<string | null>(null)
  const [mode, setMode] = useState<'current' | 'worktree'>('current')
  const [picker, setPicker] = useState<'project' | 'mode' | null>(null)
  const [model, setModel] = useState<ModelChoice>({ provider: 'claude-code', model: '', effort: '' })
  const project = list.find((p) => p.id === projectId)
  const pc = computers.find((x) => x.id === selected)
  useEffect(() => {
    // Let the sheet finish presenting before the picker slides up over it.
    const timer = setTimeout(() => setPicker('project'), 450)
    return () => clearTimeout(timer)
  }, [])

  return (
    <Screen bg="canvas">
      <Header modal title={t.newChat} subtitle={pc?.name} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={keyboardOffset}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', padding: space.l }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', gap: space.s, paddingBottom: space.xl }}>
            <T size={font.hero} weight="700" style={{ letterSpacing: -0.6 }}>
              What&apos;s next?
            </T>
            <T tone="muted" style={{ textAlign: 'center' }}>
              {offline ? `${pc?.name} is offline. The chat waits in the outbox and starts when it reconnects.` : `Runs on ${pc?.name} with your host's providers.`}
            </T>
          </View>
        </ScrollView>
        <View style={{ paddingBottom: Math.max(insets.bottom, space.s) }}>
          <Composer
            key={projectId ?? 'none'}
            running={false}
            autoFocus={projectId !== null}
            header={
              <>
                <TrayButton prompt={projectId === null} icon={project ? (project.kind === 'workspace' ? Folder : FolderGit2) : projectId === STANDALONE ? MessageCircle : Folder} label={project?.name ?? (projectId === STANDALONE ? 'Standalone' : 'Choose a project')} onPress={() => setPicker('project')} />
                {project ? <TrayButton icon={GitBranch} label={mode === 'current' ? 'Current checkout' : 'Isolated worktree'} onPress={() => setPicker('mode')} /> : null}
              </>
            }
            draftKey={`${selected}:new:${projectId ?? 'none'}`}
            offline={offline}
            placeholder={offline ? `What should the agent do? Sends when ${pc?.name ?? 'it'} is back` : t.newPlaceholder}
            model={model}
            onModel={setModel}
            onSend={async (text, _mode, attachments, context) => {
              if (projectId === null) { setPicker('project'); throw new Error('Choose a project first.') }
              const id = await createChat({ projectId, text, mode, attachments, context, ...model })
              router.replace({ pathname: '/chat/[id]', params: { id } })
            }}
          />
        </View>
      </KeyboardAvoidingView>

      <Sheet open={picker === 'project'} onClose={() => setPicker(null)} title="Project">
        {list.map((p) => (
          <Row key={p.id} onPress={() => { setProjectId(p.id); setPicker(null) }}>
            {p.kind === 'workspace' ? <Folder size={17} color={c.soft} /> : <FolderGit2 size={17} color={c.soft} />}
            <View style={{ flex: 1 }}>
              <T weight="500">{p.name}</T>
              <T size={font.caption} tone="muted">
                {p.root}
              </T>
            </View>
            {p.id === projectId ? <Check size={16} color={c.accent} /> : null}
          </Row>
        ))}
        <Row onPress={() => { setProjectId(STANDALONE); setPicker(null) }}>
          <MessageCircle size={17} color={c.soft} />
          <View style={{ flex: 1 }}>
            <T weight="500">Standalone</T>
            <T size={font.caption} tone="muted">
              No project folder
            </T>
          </View>
          {projectId === STANDALONE ? <Check size={16} color={c.accent} /> : null}
        </Row>
        <Row onPress={() => { setPicker(null); router.push('/folders') }}>
          <Monitor size={17} color={c.muted} />
          <T tone="muted">Add a folder on {pc?.name}…</T>
        </Row>
      </Sheet>

      <Sheet open={picker === 'mode'} onClose={() => setPicker(null)} title="Checkout">
        {(
          [
            ['current', 'Current checkout', 'Work directly in the folders on disk.'],
            ['worktree', 'Isolated worktrees', 'A new branch and worktree per repository.'],
          ] as const
        ).map(([value, label, hint]) => (
          <Row key={value} onPress={() => { setMode(value); setPicker(null) }}>
            <View style={{ flex: 1 }}>
              <T weight="500">{label}</T>
              <T size={font.caption} tone="muted">
                {hint}
              </T>
            </View>
            {mode === value ? <Check size={16} color={c.accent} /> : null}
          </Row>
        ))}
      </Sheet>
    </Screen>
  )
}
