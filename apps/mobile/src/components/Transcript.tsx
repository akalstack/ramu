import { useEffect, useState, type ReactNode } from 'react'
import { Linking, Pressable, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FilePen,
  Flag,
  Globe,
  Lightbulb,
  Search,
  ShieldAlert,
  SquareTerminal,
  Wrench,
  X,
} from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import type { Chat, ToolKind, TranscriptItem } from '../runtime/types'
import { useStore } from '../runtime/store'
import { Markdown } from './Markdown'
import { Button, Card, Divider, T, tap, type Icon } from './ui'
import { formatDuration } from '../runtime/turns'

const toolIcons: Record<ToolKind, Icon> = { read: FileCode2, edit: FilePen, search: Search, execute: SquareTerminal, think: Lightbulb, fetch: Globe, other: Wrench }

export function TranscriptItemView({ item, chat }: { item: TranscriptItem; chat: Chat }) {
  switch (item.kind) {
    case 'user':
      return <UserBubble text={item.text} />
    case 'text':
      return <Markdown text={item.text} />
    case 'tool':
      return <ToolRow item={item} />
    case 'agents':
      return <AgentsGroup item={item} />
    case 'question':
      return <QuestionCard item={item} chatId={chat.id} />
    case 'permission':
      return <PermissionCard item={item} chatId={chat.id} />
    case 'elicitation':
      return <ElicitationCard item={item} chatId={chat.id} />
    case 'changes':
      return <ChangesCard item={item} chatId={chat.id} />
    case 'goal':
      return <GoalDone item={item} />
    case 'working':
      return <WorkingRule since={item.since} />
    case 'summary':
      return <TurnSummary label={item.label}>{item.items.map(child => <TranscriptItemView key={child.id} item={child} chat={chat} />)}</TurnSummary>
    case 'end':
      return null
  }
}

/** Live "Working for 12s" above the running turn's steps. */
function WorkingRule({ since }: { since?: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <T size={font.control} tone="muted" accessibilityRole="text" style={{ fontVariant: ['tabular-nums'] }}>
      {since ? `Working for ${formatDuration(Math.max(0, now - since))}` : 'Working'}
    </T>
  )
}

/** "Worked for 12m 48s": a finished turn's routine steps, collapsed until tapped. */
function TurnSummary({ label, children }: { label: string; children: ReactNode }) {
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  return (
    <View style={{ gap: space.m }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => { tap(); setOpen(o => !o) }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 2 }}>
        <T size={font.control} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>{label}</T>
        {open ? <ChevronDown size={14} color={c.muted} /> : <ChevronRight size={14} color={c.muted} />}
      </Pressable>
      {open ? <View style={{ gap: space.m, paddingLeft: space.s, borderLeftWidth: 1, borderLeftColor: c.line }}>{children}</View> : null}
    </View>
  )
}

function UserBubble({ text }: { text: string }) {
  const { c } = useTheme()
  return (
    <View style={{ alignSelf: 'flex-end', maxWidth: '86%', backgroundColor: c.bubble, borderRadius: radius.l - 2, borderBottomRightRadius: radius.xs, paddingHorizontal: space.m + 2, paddingVertical: space.s + 2 }}>
      <T tone="text" style={{ lineHeight: 21 }}>
        {text}
      </T>
    </View>
  )
}

function ToolRow({ item }: { item: Extract<TranscriptItem, { kind: 'tool' }> }) {
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const I = toolIcons[item.tool]
  const running = item.status === 'in_progress'
  const failed = item.status === 'failed'
  return (
    <View>
      <Pressable
        disabled={!item.detail}
        onPress={() => {
          tap()
          setOpen((o) => !o)
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: 3 }}
      >
        <I size={14} color={failed ? c.bad : running ? c.accent : c.muted} strokeWidth={1.8} />
        <T size={font.control} tone={running ? 'soft' : 'muted'} weight="500">
          {item.verb}
        </T>
        <T size={font.control} tone={failed ? 'bad' : 'muted'} mono={item.tool !== 'search' && item.tool !== 'fetch'} numberOfLines={1} style={{ flexShrink: 1 }}>
          {item.subject}
        </T>
        {item.detail ? open ? <ChevronDown size={13} color={c.placeholder} /> : <ChevronRight size={13} color={c.placeholder} /> : null}
      </Pressable>
      {open && item.detail ? (
        <View style={{ marginLeft: 22, marginTop: 4, padding: space.s + 2, backgroundColor: c.code, borderRadius: radius.s }}>
          <T size={font.caption} mono tone={failed ? 'bad' : 'soft'}>
            {item.detail}
          </T>
        </View>
      ) : null}
    </View>
  )
}

function AgentsGroup({ item }: { item: Extract<TranscriptItem, { kind: 'agents' }> }) {
  const { c } = useTheme()
  const [open, setOpen] = useState(true)
  const done = item.agents.filter((a) => a.status !== 'running').length
  return (
    <Card>
      <Pressable
        onPress={() => {
          tap()
          setOpen((o) => !o)
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, padding: space.m }}
      >
        <Bot size={15} color={c.soft} strokeWidth={1.8} />
        <T size={font.control} weight="600" style={{ flex: 1 }}>
          {item.agents.length} agents
        </T>
        <T size={font.caption} tone="muted">
          {done}/{item.agents.length} done
        </T>
        {open ? <ChevronDown size={14} color={c.muted} /> : <ChevronRight size={14} color={c.muted} />}
      </Pressable>
      {open
        ? item.agents.map((a, i) => (
            <View key={i}>
              <Divider inset={space.m} />
              <View style={{ padding: space.m, gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: a.status === 'running' ? c.accent : a.status === 'failed' ? c.bad : c.ok }} />
                  <T size={font.control} weight="500" style={{ flex: 1 }} numberOfLines={1}>
                    {a.name}
                  </T>
                  <T size={font.caption} tone="muted">
                    {a.type}
                  </T>
                </View>
                <T size={font.caption + 1} tone="muted" style={{ marginLeft: 14, lineHeight: 18 }}>
                  {a.summary}
                </T>
              </View>
            </View>
          ))
        : null}
    </Card>
  )
}

function Option({ label, description, selected, multi, onPress }: { label: string; description?: string; selected: boolean; multi: boolean; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={() => {
        tap()
        onPress()
      }}
      style={({ pressed }) => ({ flexDirection: 'row', gap: space.m, padding: space.m, borderRadius: radius.s + 2, backgroundColor: selected ? c.accentWash : pressed ? c.pressed : c.fill })}
    >
      <View style={{ width: 18, height: 18, marginTop: 1, borderRadius: multi ? 5 : 9, borderWidth: 1.5, borderColor: selected ? c.primary : c.lineStrong, backgroundColor: selected ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {selected ? <Check size={11} color="#fff" strokeWidth={3} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T size={font.body - 1} weight="500">
          {label}
        </T>
        {description ? (
          <T size={font.caption + 1} tone="muted" style={{ lineHeight: 18 }}>
            {description}
          </T>
        ) : null}
      </View>
    </Pressable>
  )
}

function QuestionCard({ item, chatId }: { item: Extract<TranscriptItem, { kind: 'question' }>; chatId: string }) {
  const { c } = useTheme()
  const store = useStore()
  const { answer } = store
  const chat = store.chats.find(c => c.id === chatId)
  const draftKey = `${chat?.computerId}:input:${chat?.sessionId}:${item.id}`
  let draft: { picked?: Record<string, string[]>; other?: Record<string, string> } = {}
  try { draft = JSON.parse(store.drafts[draftKey] ?? '{}') } catch {}
  const [picked, setPicked] = useState<Record<string, string[]>>(draft.picked ?? {})
  const [other, setOther] = useState<Record<string, string>>(draft.other ?? {})
  useEffect(() => { store.setDraft(draftKey, JSON.stringify({ picked, other })) }, [draftKey, picked, other])
  if (item.answers) {
    return (
      <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'center' }}>
        <Check size={14} color={c.ok} />
        <T size={font.control} tone="muted" style={{ flex: 1 }} numberOfLines={2}>
          Answered: {Object.values(item.answers).join(' · ')}
        </T>
      </View>
    )
  }
  const ready = item.questions.every((q) => (picked[q.id ?? q.question]?.length ?? 0) > 0 || other[q.id ?? q.question]?.trim())
  return (
    <Card style={{ padding: space.m, gap: space.m, backgroundColor: c.raised2 }}>
      {item.submitted ? <T tone="muted" size={font.caption}>Already submitted: {Object.values(item.submitted).join(' · ')}</T> : null}
      {item.questions.map((q) => (
        <View key={q.question} style={{ gap: space.s }}>
          <T size={font.caption} weight="600" tone="warn" style={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {q.header}
          </T>
          <T size={font.body} weight="600" style={{ lineHeight: 21, marginBottom: 2 }}>
            {q.question}
          </T>
          {q.options.map((o) => {
            const sel = picked[q.id ?? q.question]?.includes(o.label) ?? false
            return (
              <Option
                key={o.label}
                label={o.label}
                description={o.description}
                multi={q.multiSelect}
                selected={sel}
                onPress={() =>
                  setPicked((p) => {
                    const cur = p[q.id ?? q.question] ?? []
                    const next = q.multiSelect ? (sel ? cur.filter((x) => x !== o.label) : [...cur, o.label]) : sel ? [] : [o.label]
                    return { ...p, [q.id ?? q.question]: next }
                  })
                }
              />
            )
          })}
          <TextInput
            placeholder="Other answer…"
            placeholderTextColor={c.placeholder}
            value={other[q.id ?? q.question] ?? ''}
            onChangeText={(v) => setOther((o) => ({ ...o, [q.id ?? q.question]: v }))}
            style={{ color: c.text, fontSize: font.body - 1, padding: space.m, borderRadius: radius.s + 2, backgroundColor: c.fill }}
          />
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: space.s, justifyContent: 'flex-end' }}>
        <Button kind="ghost" title="Dismiss" onPress={() => answer(chatId, item.id, { _: 'Dismissed' })} />
        <Button
          title="Submit"
          disabled={!ready}
          onPress={() =>
            answer(
              chatId,
              item.id,
              Object.fromEntries(item.questions.map((q) => [q.id ?? q.question, [...(picked[q.id ?? q.question] ?? []), other[q.id ?? q.question]?.trim()].filter(Boolean).join(', ')])),
            )
          }
        />
      </View>
    </Card>
  )
}

function PermissionCard({ item, chatId }: { item: Extract<TranscriptItem, { kind: 'permission' }>; chatId: string }) {
  const { c } = useTheme()
  const { decide } = useStore()
  if (item.decision) {
    const allowed = item.decision === 'allow'
    return (
      <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'center' }}>
        {allowed ? <Check size={14} color={c.ok} /> : <X size={14} color={c.bad} />}
        <T size={font.control} tone="muted" mono numberOfLines={1} style={{ flex: 1 }}>
          {allowed ? 'Allowed' : 'Denied'} · {item.command}
        </T>
      </View>
    )
  }
  return (
    <Card style={{ padding: space.m, gap: space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <ShieldAlert size={16} color={c.warn} strokeWidth={1.8} />
        <T size={font.body} weight="600">
          {item.title}
        </T>
      </View>
      <View style={{ backgroundColor: c.code, borderRadius: radius.s, padding: space.m }}>
        <T size={font.caption + 1} mono tone="soft">
          {item.command}
        </T>
      </View>
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button kind="secondary" title="Deny" style={{ flex: 1 }} onPress={() => decide(chatId, item.id, 'deny')} />
        <Button title="Allow once" style={{ flex: 1 }} onPress={() => decide(chatId, item.id, 'allow')} />
      </View>
    </Card>
  )
}

function ChangesCard({ item, chatId }: { item: Extract<TranscriptItem, { kind: 'changes' }>; chatId: string }) {
  const { c } = useTheme()
  const router = useRouter()
  return (
    <Pressable
      onPress={() => {
        tap()
        router.push({ pathname: '/chat/[id]/changes', params: { id: chatId } })
      }}
    >
      {({ pressed }) => (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.m, opacity: pressed ? 0.8 : 1 }}>
          <FilePen size={16} color={c.soft} strokeWidth={1.8} />
          <T size={font.body - 1} weight="500" style={{ flex: 1 }}>
            {item.files} files changed
          </T>
          <T size={font.control} mono tone="ok">
            +{item.additions}
          </T>
          <T size={font.control} mono tone="bad">
            −{item.deletions}
          </T>
          <ChevronRight size={16} color={c.muted} />
        </Card>
      )}
    </Pressable>
  )
}

function GoalDone({ item }: { item: Extract<TranscriptItem, { kind: 'goal' }> }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
      <Flag size={14} color={c.ok} strokeWidth={1.8} />
      <T size={font.control} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
        Goal reached in {item.turns} turns · {item.objective}
      </T>
    </View>
  )
}

function ElicitationCard({ item, chatId }: { item: Extract<TranscriptItem, { kind: 'elicitation' }>; chatId: string }) {
  const { c } = useTheme()
  const { elicitation } = useStore()
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(item.request.fields.map(f => [f.id, f.defaultValue ?? ''])))
  if (item.outcome) return <T tone="muted">{item.request.message} · {item.outcome}</T>
  return <Card style={{ padding: space.m, gap: space.m }}>
    <T weight="600">{item.request.serverName}</T><T>{item.request.message}</T>
    {item.request.mode === 'url' && item.request.url ? <Button title="Open request" onPress={() => { const url = item.request.url!; if (/^https?:\/\//i.test(url)) void Linking.openURL(url) }} /> : null}
    {item.request.fields.map(f => <View key={f.id} style={{ gap: space.s }}><T>{f.label}{f.required ? ' *' : ''}</T><T size={font.caption} tone="muted">{f.description || (f.options.length ? f.options.map(o => `${o.label}: ${o.value}`).join(', ') : f.type)}</T><TextInput value={answers[f.id] ?? ''} onChangeText={v => setAnswers(old => ({ ...old, [f.id]: v }))} style={{ color: c.text, backgroundColor: c.fill, padding: space.m }} /></View>)}
    <View style={{ flexDirection: 'row', gap: space.s }}><Button kind="secondary" title="Decline" onPress={() => elicitation(chatId, item.id, 'decline', {})} /><Button title="Submit" disabled={item.request.fields.some(f => f.required && !answers[f.id]?.trim())} onPress={() => elicitation(chatId, item.id, 'accept', answers)} /></View>
  </Card>
}
