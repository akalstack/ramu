import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Check, ChevronDown, Folder, FolderGit2, GitBranch, MessageCircle, Monitor } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { STANDALONE } from '../runtime/types'
import { useT } from '../i18n'
import { Header, Screen } from '../components/Screen'
import { useKeyboardInset } from '../components/Keyboard'
import { AnimatedMark } from '../components/AnimatedMark'
import { Composer, type ModelChoice } from '../components/Composer'
import { Row, Sheet, T, tap } from '../components/ui'

function TrayButton({
  icon: I,
  label,
  onPress,
  prompt,
}: {
  icon: typeof Folder
  label: string
  onPress: () => void
  prompt?: boolean
}) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={() => {
        tap()
        onPress()
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 32,
        paddingHorizontal: space.s + 2,
        borderRadius: radius.s,
        backgroundColor: pressed ? c.pressed : prompt ? c.accentWash : 'transparent',
      })}
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
  const keyboardInset = useKeyboardInset()
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const store = useStore()
  const { projects, computers, createChat, isOnline } = store
  const params = useLocalSearchParams<{ project?: string; quote?: string; computer?: string }>()
  const [selected, setHost] = useState(params.computer ?? store.selected)
  const offline = !isOnline(selected)
  const list = projects.filter((p) => p.computerId === selected)
  // A chat runs in a project's folders, so the project is chosen first rather than defaulted.
  const [projectId, setProjectId] = useState<string | null>(params.project ?? null)
  const [mode, setMode] = useState<'current' | 'worktree'>('current')
  const [picker, setPicker] = useState<'project' | 'mode' | 'host' | null>(null)
  // Starts on the computer's default model step (Settings › Models), like the desktop; a pick here overrides it.
  const [picked, setModel] = useState<ModelChoice | null>(null)
  const preset = store.defaults[selected]
  const model: ModelChoice =
    picked ??
    (preset
      ? {
          provider: preset.provider,
          model: preset.model,
          effort: preset.effort ?? '',
          settings: { access: preset.access, autoFallback: preset.autoFallback, serviceTier: preset.serviceTier },
        }
      : { provider: 'claude-code', model: '', effort: '' })
  const project = list.find((p) => p.id === projectId)
  const pc = computers.find((x) => x.id === selected)
  useEffect(() => {
    // Let the sheet finish presenting before the picker slides up over it.
    if (params.project) return
    const timer = setTimeout(() => setPicker('project'), 450)
    return () => clearTimeout(timer)
  }, [params.project])

  return (
    <Screen bg="canvas" scrollable={false}>
      <Header modal title={t.newChat} subtitle={pc?.name} />
      <View style={{ flex: 1, paddingBottom: keyboardInset }}>
        {/* Nothing here scrolls: the hero simply centers in the space above the composer. */}
        <View style={{ flex: 1, justifyContent: 'center', padding: space.l }}>
          <View style={{ alignItems: 'center', gap: space.s }}>
            {/* The desktop's start screen: the animated mark (tap it) over the same question. */}
            <View style={{ marginBottom: space.s }}>
              <AnimatedMark size={56} />
            </View>
            <T size={font.hero} weight="600" style={{ letterSpacing: -0.5, textAlign: 'center' }}>
              {project ? `What should we work on in ${project.name}?` : 'What should we work on?'}
            </T>
            <T tone="muted" style={{ textAlign: 'center' }}>
              {offline
                ? `${pc?.name} is offline. The thread waits in the outbox and starts when it reconnects.`
                : `Runs on ${pc?.name} with your host's providers.`}
            </T>
          </View>
        </View>
        <View style={{ paddingBottom: Math.max(insets.bottom, space.s) }}>
          <Composer
            key={`${selected}:${projectId ?? 'none'}`}
            running={false}
            restore={
              params.quote
                ? {
                    text: `${params.quote
                      .trim()
                      .split('\n')
                      .map((line) => `> ${line}`)
                      .join('\n')}\n\n`,
                    n: 1,
                  }
                : undefined
            }
            autoFocus={projectId !== null}
            header={
              <>
                {computers.length > 1 && (
                  <TrayButton icon={Monitor} label={pc?.name ?? t.computers} onPress={() => setPicker('host')} />
                )}
                <TrayButton
                  prompt={projectId === null}
                  icon={
                    project
                      ? project.kind === 'workspace'
                        ? Folder
                        : FolderGit2
                      : projectId === STANDALONE
                        ? MessageCircle
                        : Folder
                  }
                  label={project?.name ?? (projectId === STANDALONE ? 'Standalone' : 'Choose a project')}
                  onPress={() => setPicker('project')}
                />
                {project ? (
                  <TrayButton
                    icon={GitBranch}
                    label={mode === 'current' ? 'Current checkout' : 'Isolated worktree'}
                    onPress={() => setPicker('mode')}
                  />
                ) : null}
              </>
            }
            draftKey={`${selected}:new:${projectId ?? 'none'}`}
            computerId={selected}
            scope={
              projectId && projectId !== STANDALONE
                ? `project:${projectId.slice(projectId.indexOf(':') + 1)}`
                : undefined
            }
            offline={offline}
            placeholder={
              offline ? `What should the agent do? Sends when ${pc?.name ?? 'it'} is back` : t.newPlaceholder
            }
            model={model}
            onModel={setModel}
            onSend={async (text, _mode, attachments, context) => {
              if (projectId === null) {
                setPicker('project')
                throw new Error('Choose a project first.')
              }
              const id = await createChat({
                computerId: selected,
                projectId,
                text,
                mode,
                attachments,
                context,
                ...model,
              })
              router.replace({ pathname: '/chat/[id]', params: { id } })
            }}
          />
        </View>
      </View>

      <Sheet open={picker === 'host'} onClose={() => setPicker(null)} title={t.computers}>
        {computers.map((computer) => (
          <Row
            key={computer.id}
            onPress={() => {
              if (computer.status === 'revoked') return
              if (computer.id !== selected) {
                setHost(computer.id)
                setProjectId(null)
                setModel(null)
                setMode('current')
              }
              setPicker('project')
            }}
          >
            <Monitor size={17} color={c.soft} />
            <View style={{ flex: 1 }}>
              <T weight="500">{computer.name}</T>
              <T size={font.caption} tone="muted">
                {t[computer.status]}
              </T>
            </View>
            {computer.id === selected ? <Check size={16} color={c.accent} /> : null}
          </Row>
        ))}
      </Sheet>
      <Sheet open={picker === 'project'} onClose={() => setPicker(null)} title="Project">
        {list.map((p) => (
          <Row
            key={p.id}
            onPress={() => {
              setProjectId(p.id)
              setPicker(null)
            }}
          >
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
        <Row
          onPress={() => {
            setProjectId(STANDALONE)
            setPicker(null)
          }}
        >
          <MessageCircle size={17} color={c.soft} />
          <View style={{ flex: 1 }}>
            <T weight="500">Standalone</T>
            <T size={font.caption} tone="muted">
              No project folder
            </T>
          </View>
          {projectId === STANDALONE ? <Check size={16} color={c.accent} /> : null}
        </Row>
        <Row
          onPress={() => {
            setPicker(null)
            store.select(selected)
            router.push('/folders')
          }}
        >
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
          <Row
            key={value}
            onPress={() => {
              setMode(value)
              setPicker(null)
            }}
          >
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
