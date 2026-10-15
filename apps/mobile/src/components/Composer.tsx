import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native'
import { ArrowUp, Check, ChevronDown, Clock, CornerDownRight, Flag, ListPlus, Pause, Play, Plus, Square, X } from 'lucide-react-native'
import type { AgentProvider, AgentSettings, ChatGoal, FileContext, QueuedMessage, SkillInfo } from '@ramu/shared/types'
import { font, radius, space, useTheme } from '../theme'
import { providerNames } from '../runtime/types'
import { useStore } from '../runtime/store'
import { useT } from '../i18n'
import { IconButton, Row, Sheet, T, tap } from './ui'
import { ProviderIcon } from './Logos'
import { Glass } from './Glass'

export interface ModelChoice {
  provider: AgentProvider
  model: string
  effort: string
  settings?: Pick<AgentSettings, 'access' | 'autoFallback' | 'serviceTier'>
}

export function modelLabel(m: ModelChoice) {
  return m.model || providerNames[m.provider]
}

export function ModelChip({ value, onChange, computerId }: { value: ModelChoice; onChange: (m: ModelChoice) => void; computerId?: string }) {
  const store = useStore()
  const models = (store.catalogs[computerId ?? store.selected] ?? []).flatMap(p => p.models.map(m => ({ provider: p.provider, model: m.id, label: m.name, efforts: m.efforts as string[] })))
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const current = models.find((m) => m.provider === value.provider && m.model === value.model)
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Model"
        onPress={() => {
          tap()
          setOpen(true)
        }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, height: 40, paddingHorizontal: space.s + 2, borderRadius: radius.s, backgroundColor: pressed ? c.pressed : 'transparent' })}
      >
        <ProviderIcon provider={value.provider} size={14} />
        <T size={font.control} weight="500" tone="soft" numberOfLines={1} style={{ marginLeft: 2, maxWidth: 140 }}>
          {modelLabel(value)}
        </T>
        <T size={font.control} tone="muted">
          {value.effort}
        </T>
        <ChevronDown size={13} color={c.muted} />
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)} title="Model">
        {(Object.keys(providerNames) as AgentProvider[])
          .filter((p) => models.some((m) => m.provider === p))
          .map((p) => (
            <View key={p}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: 4 }}>
                <ProviderIcon provider={p} size={13} />
                <T size={font.caption} weight="600" tone="muted" style={{ textTransform: 'uppercase', letterSpacing: 0.3 }}>
                  {providerNames[p]}
                </T>
              </View>
              {models
                .filter((m) => m.provider === p)
                .map((m) => (
                  <Row key={m.model} onPress={() => onChange({ settings: value.settings, provider: m.provider, model: m.model, effort: m.efforts.includes(value.effort) ? value.effort : (m.efforts[0] ?? '') })}>
                    <ProviderIcon provider={m.provider} size={18} />
                    <View style={{ flex: 1 }}>
                      <T weight={m.provider === value.provider && m.model === value.model ? '600' : '400'}>{m.label}</T>
                      <T size={font.caption} tone="muted" mono>
                        {m.model}
                      </T>
                    </View>
                    {m.provider === value.provider && m.model === value.model ? <Check size={17} color={c.accent} /> : null}
                  </Row>
                ))}
            </View>
          ))}
        {current && current.efforts.length > 1 ? (
          <View style={{ paddingHorizontal: space.l, paddingTop: space.l, gap: space.s }}>
            <T size={font.caption} weight="600" tone="muted" style={{ textTransform: 'uppercase', letterSpacing: 0.3 }}>
              Reasoning
            </T>
            <View style={{ flexDirection: 'row', backgroundColor: c.fill, borderRadius: radius.s + 2, padding: 3 }}>
              {current.efforts.map((e) => (
                <Pressable
                  key={e}
                  onPress={() => {
                    tap()
                    onChange({ ...value, effort: e })
                  }}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: radius.s, backgroundColor: e === value.effort ? c.raised : 'transparent' }}
                >
                  <T size={font.control} weight={e === value.effort ? '600' : '400'} tone={e === value.effort ? 'text' : 'muted'}>
                    {e}
                  </T>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </Sheet>
    </>
  )
}

/** Tray rows at the top of the composer: the live goal first, then queued and steering messages. */
function Tray({ goal, queue, onToggleGoal, onClearGoal, onRemove }: { goal: ChatGoal | null; queue: QueuedMessage[]; onToggleGoal?: () => void; onClearGoal?: () => void; onRemove?: (id: string) => void }) {
  const { c } = useTheme()
  const t = useT()
  if (!goal && !queue.length) return null
  const paused = goal?.status === 'paused'
  return (
    <View style={{ paddingHorizontal: space.m, paddingTop: 4, paddingBottom: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.lineStrong }}>
      {goal ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 32 }}>
          <Flag size={14} color={paused ? c.muted : c.accent} strokeWidth={1.8} />
          <T size={font.control} tone={paused ? 'muted' : 'soft'} numberOfLines={1} style={{ flex: 1 }}>
            {goal.objective}
          </T>
          <T size={font.caption} tone="muted">
            {paused ? 'paused' : `turn ${goal.turns}`}
          </T>
          <IconButton icon={paused ? Play : Pause} label={paused ? 'Resume goal' : 'Pause goal'} size={28} tone="muted" onPress={onToggleGoal} />
          <IconButton icon={X} label="Clear goal" size={28} tone="muted" onPress={onClearGoal} />
        </View>
      ) : null}
      {queue.map((q) => (
        <View key={q.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 32 }}>
          {q.mode === 'steer' ? <CornerDownRight size={14} color={c.warn} strokeWidth={1.8} /> : <ListPlus size={14} color={c.muted} strokeWidth={1.8} />}
          <T size={font.control} tone="soft" numberOfLines={1} style={{ flex: 1 }}>
            {q.text}
          </T>
          <T size={font.caption} tone="muted">
            {q.mode === 'steer' ? t.steer : t.queued}
          </T>
          <IconButton icon={X} label="Remove" size={28} tone="muted" onPress={() => onRemove?.(q.id)} />
        </View>
      ))}
    </View>
  )
}

export function Composer({
  running,
  model,
  onModel,
  onSend,
  onStop,
  goal = null,
  queue = [],
  onToggleGoal,
  onClearGoal,
  onRemoveQueued,
  placeholder,
  autoFocus,
  header,
  offline,
  restore,
  draftKey,
  computerId,
  taskId,
}: {
  draftKey?: string
  computerId?: string
  taskId?: string
  running: boolean
  model: ModelChoice
  onModel: (m: ModelChoice) => void
  onSend: (text: string, mode: 'send' | 'queue' | 'steer', attachments?: string[], context?: FileContext[]) => Promise<void> | void
  onStop?: () => void
  goal?: ChatGoal | null
  queue?: QueuedMessage[]
  onToggleGoal?: () => void
  onClearGoal?: () => void
  onRemoveQueued?: (id: string) => void
  placeholder?: string
  autoFocus?: boolean
  /** Extra controls above the input, e.g. the project and checkout pickers. */
  header?: ReactNode
  /** The computer is unreachable: sends go to the outbox. */
  offline?: boolean
  /** Puts text back into the input (e.g. a cancelled outbox message); `n` changes on every restore. */
  restore?: { text: string; n: number }
}) {
  const { c } = useTheme()
  const t = useT()
  const store = useStore()
  const [text, setText] = useState(() => draftKey ? store.drafts[draftKey] ?? '' : '')
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const decodeDraft = <T,>(suffix: string, fallback: T): T => { try { return draftKey ? JSON.parse(store.drafts[`${draftKey}:${suffix}`] ?? 'null') ?? fallback : fallback } catch { return fallback } }
  const [attachments, setAttachments] = useState<import('@ramu/shared/types').Attachment[]>(() => decodeDraft('attachments', []))
  const [context, setContext] = useState<FileContext[]>(() => decodeDraft('context', []))
  const [menu, setMenu] = useState<'actions' | 'context' | 'skills' | 'settings' | null>(null)
  const [files, setFiles] = useState<{ repoId: string; path: string }[]>([])
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [filter, setFilter] = useState('')
  const [uploading, setUploading] = useState(false)
  const origin = useRef(draftKey); origin.current = draftKey
  const pc = computerId ?? store.selected
  const append = (value: string) => { const next = text + value; setText(next); if (draftKey) store.setDraft(draftKey, next) }
  const discover = async (kind: 'context' | 'skills') => {
    if (!taskId) return
    try { if (kind === 'context') setFiles(await store.invoke(pc, 'files.all', taskId)); else setSkills(await store.invoke(pc, 'skills.list', taskId)); setFilter(''); setMenu(kind) } catch(e) { Alert.alert('Could not load host choices', e instanceof Error ? e.message : String(e)) }
  }
  const upload = async (kind: 'document' | 'camera' | 'photos') => {
    if (attachments.length >= 10) return Alert.alert('Attachments', 'Attach up to ten files per message.')
    const key = draftKey; setUploading(true); setMenu(null)
    try { await pickAttachment(store, pc, a => { if (origin.current === key) setAttachments(old => [...old, a]) }, kind) } finally { setUploading(false) }
  }
  useEffect(() => { if (draftKey) store.setDraft(`${draftKey}:attachments`, JSON.stringify(attachments)) }, [attachments])
  useEffect(() => { if (draftKey) store.setDraft(`${draftKey}:context`, JSON.stringify(context)) }, [context])
  useEffect(() => { setText(draftKey ? store.drafts[draftKey] ?? '' : ''); setAttachments(decodeDraft('attachments', [])); setContext(decodeDraft('context', [])) }, [draftKey])
  const [mode, setMode] = useState<'queue' | 'steer'>('queue')
  useEffect(() => {
    if (restore) setText(restore.text)
  }, [restore])
  const has = text.trim().length > 0 || attachments.length > 0
  const submit = async () => {
    if (!has || sending.current || uploading) return
    sending.current = true; setBusy(true)
    try { await onSend(text.trim(), running ? mode : 'send', attachments.map(a => a.id), context); setText(''); setAttachments([]); setContext([]); if (draftKey) store.setDraft(draftKey, '') }
    catch (error) { Alert.alert('Could not send', error instanceof Error ? error.message : String(error)) }
    finally { sending.current = false; setBusy(false) }
  }

  return (
    <Glass radius={radius.xl} style={{ marginHorizontal: space.s + 2 }}>
      {header ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.lineStrong }}>{header}</View> : null}
      <Tray goal={goal} queue={queue} onToggleGoal={onToggleGoal} onClearGoal={onClearGoal} onRemove={onRemoveQueued} />
      {attachments.map(a => <Pressable key={a.id} onPress={() => setAttachments(old => old.filter(x => x.id !== a.id))}><T size={font.caption} style={{ padding: space.s }}>📎 {a.name} · tap to remove</T></Pressable>)}
      {context.map(file => <Pressable key={`${file.repoId}:${file.path}`} onPress={() => setContext(old => old.filter(f => f !== file))}><T size={font.caption} style={{ padding: space.s }}>@ {file.path} · tap to remove</T></Pressable>)}
      {uploading ? <T size={font.caption} tone="muted" style={{ padding: space.s }}>Uploading to this computer…</T> : null}
      <View style={{ paddingTop: space.s }}>
        <TextInput
          value={text}
          onChangeText={value => { setText(value); if (draftKey) store.setDraft(draftKey, value) }}
          multiline
          autoFocus={autoFocus}
          placeholder={placeholder ?? t.messagePlaceholder}
          placeholderTextColor={c.placeholder}
          style={{ color: c.text, fontSize: font.body, lineHeight: 21, maxHeight: 140, minHeight: 40, paddingHorizontal: space.m + 2, paddingTop: 6, paddingBottom: 6 }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.s - 2, paddingBottom: space.s - 2, gap: 2 }}>
          <IconButton icon={Plus} label="Attach" size={44} tone="muted" onPress={() => setMenu('actions')} />
          <ModelChip value={model} onChange={onModel} computerId={computerId} />
          <View style={{ flex: 1 }} />
          {running && has ? (
            <Pressable
              onPress={() => {
                tap()
                setMode((m) => (m === 'queue' ? 'steer' : 'queue'))
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: space.s + 2, borderRadius: radius.s, backgroundColor: c.fill, marginRight: 4 }}
            >
              {mode === 'steer' ? <CornerDownRight size={13} color={c.warn} /> : <ListPlus size={13} color={c.soft} />}
              <T size={font.control} weight="500" tone={mode === 'steer' ? 'warn' : 'soft'}>
                {mode === 'steer' ? t.steer : t.queue}
              </T>
            </Pressable>
          ) : null}
          {running && !has && !offline ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t.stop} onPress={() => { tap(); onStop?.() }} style={{ width: 44, height: 44, borderRadius: radius.full, backgroundColor: c.text, alignItems: 'center', justifyContent: 'center' }}>
              <Square size={16} color={c.canvas} fill={c.canvas} />
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel={offline ? 'Add to outbox' : 'Send'} disabled={!has || busy || uploading} onPress={() => { tap(); submit() }} style={{ width: 44, height: 44, borderRadius: radius.full, backgroundColor: has ? c.primary : c.fill, alignItems: 'center', justifyContent: 'center' }}>
              {offline ? <Clock size={20} color={has ? c.primaryInk : c.placeholder} strokeWidth={2.4} /> : <ArrowUp size={22} color={has ? c.primaryInk : c.placeholder} strokeWidth={2.4} />}
            </Pressable>
          )}
        </View>
      </View>
      <Sheet open={menu === 'actions'} onClose={() => setMenu(null)} title="Add to message">
        <Row onPress={() => void upload('document')}><T>Attach a file</T></Row>
        <Row onPress={() => void upload('photos')}><T>Choose a photo</T></Row>
        <Row onPress={() => void upload('camera')}><T>Take a photo</T></Row>
        {taskId ? <><Row onPress={() => void discover('context')}><T>Choose host file context</T></Row><Row onPress={() => void discover('skills')}><T>Use a host skill</T></Row></> : null}
        <Row onPress={() => setMenu('settings')}><T>Agent settings</T></Row>
        <Row onPress={() => { append('/'); setMenu(null) }}><T>Enter a command</T></Row>
      </Sheet>
      <Sheet open={menu === 'context' || menu === 'skills'} onClose={() => setMenu(null)} title={menu === 'skills' ? 'Host skills' : 'Host files'}>
        <TextInput value={filter} onChangeText={setFilter} placeholder="Search…" placeholderTextColor={c.muted} style={{ padding: space.m, color: c.text }} />
        {menu === 'skills' ? skills.filter(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 200).map(skill => <Row key={skill.path} onPress={() => { append(`\nUse the host skill at ${skill.path}.`); setMenu(null) }}><View><T>{skill.name}</T><T size={font.caption} tone="muted">{skill.description}</T></View></Row>) : files.filter(file => file.path.toLowerCase().includes(filter.toLowerCase())).slice(0, 200).map(file => <Row key={`${file.repoId}:${file.path}`} onPress={() => { if (context.length >= 30) return; if (!context.some(f => f.path === file.path && f.repoId === file.repoId)) setContext(old => [...old, { ...file, source: 'mention', referenceOnly: true }]); setMenu(null) }}><T>{file.path}</T></Row>)}
      </Sheet>
      <Sheet open={menu === 'settings'} onClose={() => setMenu(null)} title="Agent settings">
        {(['edits', 'auto', 'full'] as const).map(access => <Row key={access} onPress={() => onModel({ ...model, settings: { access, autoFallback: model.settings?.autoFallback ?? true, serviceTier: model.settings?.serviceTier } })}><T>{access === 'edits' ? 'Ask before commands' : access === 'auto' ? 'Automatic approvals' : 'Full access'}{(model.settings?.access ?? 'auto') === access ? ' ✓' : ''}</T></Row>)}
        <Row onPress={() => onModel({ ...model, settings: { access: model.settings?.access ?? 'auto', autoFallback: !(model.settings?.autoFallback ?? true), serviceTier: model.settings?.serviceTier } })}><T>Automatic provider fallback: {(model.settings?.autoFallback ?? true) ? 'On' : 'Off'}</T></Row>
        <Row onPress={() => onModel({ ...model, settings: { access: model.settings?.access ?? 'auto', autoFallback: model.settings?.autoFallback ?? true, serviceTier: model.settings?.serviceTier === 'fast' ? 'standard' : 'fast' } })}><T>Service tier: {model.settings?.serviceTier ?? 'standard'}</T></Row>
      </Sheet>
    </Glass>
  )
}

async function pickAttachment(store: ReturnType<typeof useStore>, computerId: string, add: (attachment: import('@ramu/shared/types').Attachment) => void, kind: 'document' | 'camera' | 'photos' = 'document') {
  try {
    if (!store.isOnline(computerId)) throw new Error('Reconnect this computer to upload an attachment.')
    let asset: { uri: string; name: string; size?: number; file?: File }
    if (kind === 'document') {
      const { getDocumentAsync } = await import('expo-document-picker')
      const result = await getDocumentAsync({ copyToCacheDirectory: true, multiple: false })
      if (result.canceled) return
      asset = result.assets[0]!
    } else {
      const picker = await import('expo-image-picker')
      if (kind === 'camera' && !(await picker.requestCameraPermissionsAsync()).granted) throw new Error('Camera permission is required to take a photo.')
      const result = kind === 'camera' ? await picker.launchCameraAsync({ quality: 0.8 }) : await picker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 })
      if (result.canceled) return
      const photo = result.assets[0]!
      asset = { uri: photo.uri, name: photo.fileName ?? `photo-${Date.now()}.jpg`, size: photo.fileSize }
    }
    if ((asset.size ?? 0) > 10_000_000) throw new Error('Attachments must be 10 MB or smaller.')
    const { File } = await import('expo-file-system')
    const base64 = asset.file ? await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = reject; reader.readAsDataURL(asset.file!) }) : await new File(asset.uri).base64()
    if (base64.length > 13_400_000) throw new Error('Attachments must be 10 MB or smaller.')
    add(await store.invoke(computerId, 'attachments.add', asset.name, base64))
  } catch (error) { Alert.alert('Attachment failed', error instanceof Error ? error.message : String(error)) }
}
