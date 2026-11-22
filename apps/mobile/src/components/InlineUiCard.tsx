import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Linking, ScrollView, Text, TextInput, View, type ViewStyle } from 'react-native'
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Calendar,
  CalendarDays,
  Camera,
  Check,
  CircleAlert,
  CircleHelp,
  CircleUser,
  CreditCard,
  Download,
  Ellipsis,
  EllipsisVertical,
  Eye,
  EyeOff,
  Folder,
  Heart,
  House,
  Image,
  Info,
  Lock,
  LockOpen,
  Mail,
  MapPin,
  Menu,
  Minus,
  Paperclip,
  Pause,
  Pencil,
  Phone,
  Play,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Send,
  Settings,
  Share2,
  ShoppingCart,
  Smartphone,
  Square,
  Star,
  Trash2,
  TriangleAlert,
  Upload,
  User,
  X,
} from 'lucide-react-native'
import { inlineRuns } from '@ramu/shared/inlineMarks'
import type { InlineSurface, InlineUiComponent, InlineUiIcon } from '@ramu/shared/chat/inlineUi'
import {
  asBoolean,
  asNumber,
  asText,
  asTextList,
  bindingTokens,
  checkComponent,
  childrenOf,
  editKey,
  evaluate,
  keepEdits,
  pressButton,
  withEdits,
  type InlineUiEdits,
  type InlineUiScope,
} from '@ramu/shared/chat/inlineUiRuntime'
import type { Chat } from '../runtime/types'
import { useStore } from '../runtime/store'
import { useSay } from '../i18n'
import { font, radius, space, useTheme } from '../theme'
import { Option as ChoiceOption } from './ChoiceOption'
import { Button, Card, Chip, IconButton, Segmented, T, Toggle, type Icon } from './ui'

const ICONS: Record<InlineUiIcon, Icon> = {
  accountCircle: CircleUser,
  add: Plus,
  arrowBack: ArrowLeft,
  arrowForward: ArrowRight,
  attachFile: Paperclip,
  calendarToday: CalendarDays,
  call: Phone,
  camera: Camera,
  check: Check,
  close: X,
  delete: Trash2,
  download: Download,
  edit: Pencil,
  event: Calendar,
  error: CircleAlert,
  favorite: Heart,
  folder: Folder,
  help: CircleHelp,
  home: House,
  info: Info,
  locationOn: MapPin,
  lock: Lock,
  lockOpen: LockOpen,
  mail: Mail,
  menu: Menu,
  moreHoriz: Ellipsis,
  moreVert: EllipsisVertical,
  notifications: Bell,
  pause: Pause,
  payment: CreditCard,
  person: User,
  phone: Smartphone,
  photo: Image,
  play: Play,
  print: Printer,
  refresh: RefreshCw,
  search: Search,
  send: Send,
  settings: Settings,
  share: Share2,
  shoppingCart: ShoppingCart,
  star: Star,
  stop: Square,
  upload: Upload,
  visibility: Eye,
  visibilityOff: EyeOff,
  warning: TriangleAlert,
}
const JUSTIFY: Record<string, ViewStyle['justifyContent']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  spaceBetween: 'space-between',
  spaceAround: 'space-around',
  spaceEvenly: 'space-evenly',
  stretch: 'flex-start',
}
const ALIGN: Record<string, ViewStyle['alignItems']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
}

interface Context {
  surface: InlineSurface
  byId: Map<string, InlineUiComponent>
  canAct: boolean
  busy: string | null
  write(tokens: readonly string[], value: unknown): void
  press(component: Extract<InlineUiComponent, { component: 'Button' }>, scope: InlineUiScope): void
}

/** Bold, italic and code from an agent's text; links stay words, so nothing in a card navigates. */
function RichText({ text, caption }: { text: string; caption?: boolean }) {
  const { c } = useTheme()
  return (
    <T size={caption ? font.caption : font.body - 1} tone={caption ? 'muted' : 'text'}>
      {text.split('\n').map((line, index) => (
        <Text key={index}>
          {index > 0 ? '\n' : null}
          {inlineRuns(line).map((run, at) =>
            run.style === 'marker' ? null : (
              <Text
                key={at}
                style={
                  run.style === 'bold'
                    ? { fontWeight: '600' }
                    : run.style === 'italic'
                      ? { fontStyle: 'italic' }
                      : run.style === 'code'
                        ? { fontFamily: font.mono, backgroundColor: c.fill }
                        : undefined
                }
              >
                {run.style === 'code' ? run.text.replace(/^`+|`+$/g, '') : run.text}
              </Text>
            ),
          )}
        </Text>
      ))}
    </T>
  )
}

function Labelled({ label, error, children }: { label?: string; error?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      {label ? (
        <T size={font.caption} tone="muted">
          {label}
        </T>
      ) : null}
      {children}
      {error ? (
        <T size={font.caption} tone="bad">
          {error}
        </T>
      ) : null}
    </View>
  )
}

function Tabbed({ tabs, render }: { tabs: { key: string; label: string }[]; render: (index: number) => ReactNode }) {
  const [tab, setTab] = useState('0')
  return (
    <View style={{ gap: space.s }}>
      <Segmented value={tab} onChange={setTab} options={tabs} small />
      {render(Number(tab))}
    </View>
  )
}

function Node({ id, scope, context, depth }: { id: string; scope: InlineUiScope; context: Context; depth: number }) {
  const { c } = useTheme()
  const say = useSay()
  const component = context.byId.get(id)
  // The host checks every reference and nesting depth before a card is recorded; this guards older events only.
  if (!component || depth > 20) return null
  const text = (value: unknown) => asText(evaluate(value, scope))
  const label = component['@accessibility']?.label ? text(component['@accessibility'].label) : undefined
  const flex: ViewStyle | undefined = component.weight ? { flexGrow: component.weight, flexBasis: 0 } : undefined
  const children = (list: string[] | { componentId: string; path: string }) =>
    childrenOf(list, scope).map((child) => (
      <Node
        key={child.key}
        id={child.id}
        scope={{ ...scope, base: child.base, index: child.index }}
        context={context}
        depth={depth + 1}
      />
    ))
  const tokens = 'value' in component ? bindingTokens(component.value, scope) : null
  const write = (value: unknown) => tokens && context.write(tokens, value)
  const check = checkComponent(component, scope)
  const editable = context.canAct && !!tokens
  const field = {
    color: c.text,
    fontSize: font.body - 1,
    padding: space.m,
    borderRadius: radius.s + 2,
    backgroundColor: c.fill,
  }
  switch (component.component) {
    case 'Text':
      return (
        <View style={flex} accessibilityLabel={label}>
          <RichText text={text(component.text)} caption={component.variant === 'caption'} />
        </View>
      )
    case 'Icon': {
      const name = text(component.name) as InlineUiIcon
      const Glyph = Object.hasOwn(ICONS, name) ? ICONS[name] : CircleHelp
      return <Glyph size={16} color={c.text} accessibilityLabel={label} />
    }
    case 'Row':
    case 'Column': {
      const row = component.component === 'Row'
      return (
        <View
          accessibilityLabel={label}
          style={[
            {
              flexDirection: row ? 'row' : 'column',
              flexWrap: row ? 'wrap' : 'nowrap',
              gap: space.s,
              justifyContent: JUSTIFY[component.justify ?? 'start'],
              alignItems: ALIGN[component.align ?? (row ? 'center' : 'stretch')],
            },
            flex,
          ]}
        >
          {children(component.children)}
        </View>
      )
    }
    case 'List':
      return component.direction === 'horizontal' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }}>
          {children(component.children)}
        </ScrollView>
      ) : (
        <View accessibilityLabel={label} style={[{ gap: space.s }, flex]}>
          {children(component.children)}
        </View>
      )
    case 'Card':
      return (
        <View
          accessibilityLabel={label}
          style={[{ padding: space.m, borderRadius: radius.m, borderWidth: 1, borderColor: c.line }, flex]}
        >
          <Node id={component.child} scope={scope} context={context} depth={depth + 1} />
        </View>
      )
    case 'Tabs':
      return (
        <Tabbed
          tabs={component.tabs.map((tab, index) => ({ key: String(index), label: text(tab.title) }))}
          render={(index) => (
            <Node id={component.tabs[index]!.child} scope={scope} context={context} depth={depth + 1} />
          )}
        />
      )
    case 'Divider':
      return component.axis === 'vertical' ? (
        <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: c.line }} />
      ) : (
        <View style={{ height: 1, backgroundColor: c.line }} />
      )
    case 'Button': {
      const child = context.byId.get(component.child)
      const title = child?.component === 'Text' ? text(child.text).replace(/\*\*|__|`/g, '') : (label ?? component.id)
      return (
        <Button
          title={context.busy === component.id ? say('Sending…') : title}
          accessibilityLabel={label ?? title}
          kind={
            component.variant === 'primary' ? 'primary' : component.variant === 'borderless' ? 'ghost' : 'secondary'
          }
          disabled={!context.canAct || !check.valid || context.busy !== null}
          onPress={() => context.press(component, scope)}
          style={flex}
        />
      )
    }
    case 'TextField': {
      const value = text(component.value)
      const name = text(component.label)
      return (
        <View style={flex}>
          <Labelled label={name} error={value && !check.valid ? check.message : undefined}>
            <TextInput
              value={value}
              editable={editable}
              accessibilityLabel={name}
              placeholder={component.placeholder === undefined ? undefined : text(component.placeholder)}
              placeholderTextColor={c.placeholder}
              multiline={component.variant === 'longText'}
              secureTextEntry={component.variant === 'obscured'}
              keyboardType={component.variant === 'number' ? 'decimal-pad' : 'default'}
              onChangeText={(next) => write(component.variant === 'number' ? (asNumber(next) ?? next) : next)}
              style={[field, component.variant === 'longText' ? { minHeight: 72, textAlignVertical: 'top' } : null]}
            />
          </Labelled>
        </View>
      )
    }
    case 'CheckBox': {
      const name = text(component.label)
      return (
        <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.m }, flex]}>
          <T style={{ flex: 1 }}>{name}</T>
          <Toggle
            value={asBoolean(evaluate(component.value, scope))}
            onValueChange={(next) => write(next)}
            disabled={!editable}
            accessibilityLabel={name}
          />
        </View>
      )
    }
    case 'ChoicePicker': {
      const selected = asTextList(evaluate(component.value, scope))
      const multiple = component.variant === 'multipleSelection'
      const toggle = (value: string) =>
        write(
          multiple ? (selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]) : [value],
        )
      const name = component.label === undefined ? label : text(component.label)
      return (
        <View style={flex}>
          <Labelled label={name} error={check.valid ? undefined : check.message}>
            {component.displayStyle === 'chips' ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                {component.options.map((option) => (
                  <Chip
                    key={option.value}
                    label={text(option.label)}
                    selected={selected.includes(option.value)}
                    onPress={() => editable && toggle(option.value)}
                  />
                ))}
              </View>
            ) : (
              <View style={{ gap: space.xs }} accessibilityRole={multiple ? undefined : 'radiogroup'}>
                {component.options.map((option) => (
                  <ChoiceOption
                    key={option.value}
                    label={text(option.label)}
                    multi={multiple}
                    selected={selected.includes(option.value)}
                    onPress={editable ? () => toggle(option.value) : undefined}
                  />
                ))}
              </View>
            )}
          </Labelled>
        </View>
      )
    }
    case 'Slider': {
      // A stepper stands in for a slider: precise with a thumb, and adjustable by VoiceOver and TalkBack.
      const min = component.min ?? 0
      const value = asNumber(evaluate(component.value, scope)) ?? min
      const step = component.steps ? (component.max - min) / component.steps : 1
      const name = component.label === undefined ? (label ?? '') : text(component.label)
      const set = (next: number) => write(Math.min(component.max, Math.max(min, Number(next.toFixed(6)))))
      return (
        <View
          style={[{ flexDirection: 'row', alignItems: 'center', gap: space.s }, flex]}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={name}
          accessibilityValue={{ min, max: component.max, now: value }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) =>
            editable && set(value + (event.nativeEvent.actionName === 'increment' ? step : -step))
          }
        >
          <T style={{ flex: 1 }}>{name}</T>
          <IconButton
            icon={Minus}
            label={say('Decrease')}
            disabled={!editable || value <= min}
            onPress={() => set(value - step)}
          />
          <T weight="600" style={{ minWidth: 36, textAlign: 'center' }}>
            {String(value)}
          </T>
          <IconButton
            icon={Plus}
            label={say('Increase')}
            disabled={!editable || value >= component.max}
            onPress={() => set(value + step)}
          />
        </View>
      )
    }
    case 'DateTimeInput': {
      const hint =
        component.enableDate && component.enableTime
          ? 'YYYY-MM-DDTHH:MM'
          : component.enableTime
            ? 'HH:MM'
            : 'YYYY-MM-DD'
      const name = component.label === undefined ? undefined : text(component.label)
      return (
        <View style={flex}>
          <Labelled label={name} error={check.valid ? undefined : check.message}>
            <TextInput
              value={text(component.value)}
              editable={editable}
              accessibilityLabel={name}
              placeholder={hint}
              placeholderTextColor={c.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
              onChangeText={write}
              style={field}
            />
          </Labelled>
        </View>
      )
    }
  }
}

/**
 * An agent's inline card on the phone, drawn with the app's own controls. Entries are kept as a draft on this phone until
 * a button sends them, and survive the agent changing the card unless it changed that same value.
 */
export function InlineUiCard({ surface, chat }: { surface: InlineSurface; chat: Chat }) {
  const say = useSay()
  const store = useStore()
  const draftKey = `${chat.computerId}:card:${chat.sessionId}:${surface.surfaceId}`
  const [edits, setEdits] = useState<InlineUiEdits>(() => {
    try {
      const saved = JSON.parse(store.drafts[draftKey] ?? '[]') as [string, { tokens: string[]; value: unknown }][]
      return new Map(Array.isArray(saved) ? saved : [])
    } catch {
      return new Map()
    }
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const previous = useRef(surface)
  useEffect(() => {
    if (previous.current.revision === surface.revision) return
    setEdits((current) => keepEdits(current, previous.current.dataModel, surface.dataModel))
    previous.current = surface
  }, [surface])
  useEffect(() => {
    store.setDraft(draftKey, edits.size ? JSON.stringify([...edits]) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- saves on [draftKey, edits]; the store's setter is stable in effect
  }, [draftKey, edits])
  const byId = useMemo(() => new Map(surface.components.map((c) => [c.id, c])), [surface.components])
  const model = useMemo(() => withEdits(surface.dataModel, edits), [surface.dataModel, edits])
  if (surface.deleted || !byId.has('root') || !chat.sessionId) return null
  const sessionId = chat.sessionId
  const viewer = store.computers.find((host) => host.id === chat.computerId)?.access === 'viewer'
  const locale = store.language === 'id' ? 'id-ID' : 'en-US'
  const context: Context = {
    surface,
    byId,
    canAct: !viewer,
    busy,
    write: (tokens, value) => setEdits((current) => new Map(current).set(editKey(tokens), { tokens, value })),
    press: (component, scope) => {
      const outcome = pressButton(surface, component, scope)
      if (outcome.kind === 'open') void Linking.openURL(outcome.url).catch(() => {})
      if (outcome.kind !== 'event') return
      setBusy(component.id)
      setError(null)
      store
        .invoke(chat.computerId, 'agent.inlineUiAction', sessionId, outcome.action)
        .then(() => store.refresh(chat.computerId))
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
        .finally(() => setBusy(null))
    },
  }
  return (
    <Card style={{ padding: space.m, gap: space.s }}>
      <View accessibilityLabel={say('Card from the agent')} style={{ gap: space.s }}>
        <Node id="root" scope={{ model, base: [], locale }} context={context} depth={0} />
      </View>
      {error ? (
        <T size={font.caption} tone="bad" accessibilityLiveRegion="polite">
          {error}
        </T>
      ) : null}
    </Card>
  )
}
