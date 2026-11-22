import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useJsonDraft } from '../composer/useJsonDraft'
import {
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
  ArrowLeft,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react'
import { cn } from 'cn'
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
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/desktop-checkbox'
import { Input } from '@/components/desktop-input'
import { StepSlider } from '@/components/step-slider'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { invoke as onThisComputer } from '../ipc'
import { useHost } from '../workspace/HostProvider'
import { errorText } from '../workspace/TaskPane'
import { t, useLanguage } from '../i18n'

const ICONS: Record<InlineUiIcon, LucideIcon> = {
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
const JUSTIFY: Record<string, CSSProperties['justifyContent']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  spaceBetween: 'space-between',
  spaceAround: 'space-around',
  spaceEvenly: 'space-evenly',
  stretch: 'stretch',
}
const ALIGN: Record<string, CSSProperties['alignItems']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
}

/** Bold, italic and code from an agent's text, drawn as text; links stay words, so nothing in a card navigates. */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, index) => (
        <span key={index}>
          {index > 0 && <br />}
          {inlineRuns(line).map((run, at) =>
            run.style === 'marker' ? null : run.style === 'bold' ? (
              <strong key={at}>{run.text}</strong>
            ) : run.style === 'italic' ? (
              <em key={at}>{run.text}</em>
            ) : run.style === 'code' ? (
              <code key={at} className="font-mono text-[0.92em]">
                {run.text.replace(/^`+|`+$/g, '')}
              </code>
            ) : (
              <span key={at}>{run.text}</span>
            ),
          )}
        </span>
      ))}
    </>
  )
}

interface Context {
  surface: InlineSurface
  byId: Map<string, InlineUiComponent>
  model: Record<string, unknown>
  locale: string
  canAct: boolean
  busy: string | null
  write(tokens: readonly string[], value: unknown): void
  press(component: Extract<InlineUiComponent, { component: 'Button' }>, scope: InlineUiScope): void
}

function Field({ label, error, children }: { label?: string; error?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      {label ? <span className="text-caption text-muted-foreground">{label}</span> : null}
      {children}
      {error ? <span className="text-caption text-destructive">{error}</span> : null}
    </label>
  )
}

function Node({
  id,
  scope,
  context,
  depth,
  inline = false,
}: {
  id: string
  scope: InlineUiScope
  context: Context
  depth: number
  /** Inside a button, where only phrasing content belongs. */
  inline?: boolean
}) {
  const component = context.byId.get(id)
  // The server checks every reference and nesting depth before a card is recorded; this guards older events only.
  if (!component || depth > 20) return null
  const text = (value: unknown) => asText(evaluate(value, scope))
  const label = component['@accessibility']?.label ? text(component['@accessibility'].label) : undefined
  const flex = component.weight ? { flexGrow: component.weight, flexBasis: 0 } : undefined
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
  switch (component.component) {
    case 'Text': {
      const Tag = inline ? 'span' : 'p'
      return (
        <Tag
          aria-label={label}
          style={flex}
          className={cn(
            'm-0 min-w-0 whitespace-pre-wrap break-words',
            component.variant === 'caption' && !inline && 'text-caption text-muted-foreground',
          )}
        >
          <RichText text={text(component.text)} />
        </Tag>
      )
    }
    case 'Icon': {
      const name = text(component.name) as InlineUiIcon
      const Icon = Object.hasOwn(ICONS, name) ? ICONS[name] : CircleHelp
      return <Icon aria-label={label} aria-hidden={label ? undefined : true} className="size-4 shrink-0" style={flex} />
    }
    case 'Row':
    case 'Column':
    case 'List': {
      const horizontal =
        component.component === 'Row' || (component.component === 'List' && component.direction === 'horizontal')
      return (
        <div
          aria-label={label}
          role={component.component === 'List' ? 'list' : undefined}
          style={{
            ...flex,
            justifyContent: 'justify' in component ? JUSTIFY[component.justify ?? 'start'] : undefined,
            alignItems: ALIGN[component.align ?? (horizontal ? 'center' : 'stretch')],
          }}
          className={cn(
            'flex min-w-0 gap-2',
            horizontal ? 'flex-row flex-wrap' : 'flex-col',
            component.component === 'List' && horizontal && 'flex-nowrap overflow-x-auto',
          )}
        >
          {children(component.children)}
        </div>
      )
    }
    case 'Card':
      return (
        <div
          style={flex}
          aria-label={label}
          className="min-w-0 rounded-(--radius-m) p-3 [border:1px_solid_var(--line)]"
        >
          <Node id={component.child} scope={scope} context={context} depth={depth + 1} />
        </div>
      )
    case 'Tabs':
      return (
        <Tabs defaultValue="0" style={flex} className="min-w-0 gap-2">
          <TabsList variant="line" aria-label={label}>
            {component.tabs.map((tab, index) => (
              <TabsTrigger key={index} value={String(index)}>
                {text(tab.title)}
              </TabsTrigger>
            ))}
          </TabsList>
          {component.tabs.map((tab, index) => (
            <TabsContent key={index} value={String(index)}>
              <Node id={tab.child} scope={scope} context={context} depth={depth + 1} />
            </TabsContent>
          ))}
        </Tabs>
      )
    case 'Divider':
      return <Separator orientation={component.axis === 'vertical' ? 'vertical' : 'horizontal'} />
    case 'Button': {
      const sending = context.busy === component.id
      return (
        <Button
          style={flex}
          aria-label={label}
          variant={
            component.variant === 'primary' ? 'default' : component.variant === 'borderless' ? 'ghost' : 'secondary'
          }
          disabled={!context.canAct || !check.valid || context.busy !== null}
          title={check.valid ? undefined : check.message}
          onClick={() => context.press(component, scope)}
        >
          {sending ? (
            t('Sending…')
          ) : (
            <Node id={component.child} scope={scope} context={context} depth={depth + 1} inline />
          )}
        </Button>
      )
    }
    case 'TextField': {
      const value = text(component.value)
      const placeholder = component.placeholder === undefined ? undefined : text(component.placeholder)
      const error = value && !check.valid ? check.message : undefined
      return (
        <div style={flex} className="min-w-0">
          <Field label={text(component.label)} error={error}>
            {component.variant === 'longText' ? (
              <Textarea
                value={value}
                placeholder={placeholder}
                disabled={!editable}
                aria-invalid={!!error}
                onChange={(event) => write(event.target.value)}
                className="min-h-16"
              />
            ) : (
              <Input
                value={value}
                placeholder={placeholder}
                disabled={!editable}
                aria-invalid={!!error}
                type={
                  component.variant === 'obscured' ? 'password' : component.variant === 'number' ? 'number' : 'text'
                }
                onChange={(event) =>
                  write(
                    component.variant === 'number'
                      ? (asNumber(event.target.value) ?? event.target.value)
                      : event.target.value,
                  )
                }
              />
            )}
          </Field>
        </div>
      )
    }
    case 'CheckBox':
      return (
        <label style={flex} className="flex min-w-0 items-center gap-2">
          <Checkbox
            checked={asBoolean(evaluate(component.value, scope))}
            disabled={!editable}
            onCheckedChange={(checked) => write(checked === true)}
          />
          <span>{text(component.label)}</span>
        </label>
      )
    case 'ChoicePicker': {
      const selected = asTextList(evaluate(component.value, scope))
      const multiple = component.variant === 'multipleSelection'
      const toggle = (value: string) =>
        write(
          multiple ? (selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]) : [value],
        )
      const groupLabel = component.label === undefined ? label : text(component.label)
      return (
        <fieldset style={flex} className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
          {groupLabel ? <legend className="mb-1 p-0 text-caption text-muted-foreground">{groupLabel}</legend> : null}
          {component.displayStyle === 'chips' || !multiple ? (
            <div role={multiple ? 'group' : 'radiogroup'} aria-label={groupLabel} className="flex flex-wrap gap-1.5">
              {component.options.map((option) => {
                const on = selected.includes(option.value)
                return (
                  <Button
                    key={option.value}
                    role={multiple ? undefined : 'radio'}
                    aria-checked={multiple ? undefined : on}
                    aria-pressed={multiple ? on : undefined}
                    variant={on ? 'default' : 'secondary'}
                    disabled={!editable}
                    onClick={() => toggle(option.value)}
                  >
                    {text(option.label)}
                  </Button>
                )
              })}
            </div>
          ) : (
            component.options.map((option) => (
              <label key={option.value} className="flex items-center gap-2">
                <Checkbox
                  checked={selected.includes(option.value)}
                  disabled={!editable}
                  onCheckedChange={() => toggle(option.value)}
                />
                <span>{text(option.label)}</span>
              </label>
            ))
          )}
          {!check.valid && check.message ? (
            <span className="text-caption text-destructive">{check.message}</span>
          ) : null}
        </fieldset>
      )
    }
    case 'Slider': {
      const min = component.min ?? 0
      const value = asNumber(evaluate(component.value, scope)) ?? min
      const step = component.steps ? (component.max - min) / component.steps : 1
      const name = component.label === undefined ? (label ?? '') : text(component.label)
      return (
        <div style={flex} className="flex min-w-0 flex-col gap-1">
          <div className="flex justify-between text-caption text-muted-foreground">
            <span>{name}</span>
            <span>{value}</span>
          </div>
          <StepSlider
            value={value}
            min={min}
            max={component.max}
            step={step > 0 ? step : 1}
            thumbLabel={name}
            disabled={!editable}
            onValueChange={(next) => write(Array.isArray(next) ? next[0] : next)}
          />
        </div>
      )
    }
    case 'DateTimeInput': {
      const type =
        component.enableDate && component.enableTime ? 'datetime-local' : component.enableTime ? 'time' : 'date'
      const bound = (value: unknown) => (value === undefined ? undefined : text(value) || undefined)
      return (
        <div style={flex} className="min-w-0">
          <Field
            label={component.label === undefined ? undefined : text(component.label)}
            error={check.valid ? undefined : check.message}
          >
            <Input
              type={type}
              value={text(component.value)}
              min={bound(component.min)}
              max={bound(component.max)}
              disabled={!editable}
              onChange={(event) => write(event.target.value)}
            />
          </Field>
        </div>
      )
    }
  }
}

type SavedEdits = [string, { tokens: readonly string[]; value: unknown }][]
const isSavedEdits = (value: unknown): value is SavedEdits =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      Array.isArray(entry) &&
      typeof entry[0] === 'string' &&
      !!entry[1] &&
      typeof entry[1] === 'object' &&
      Array.isArray((entry[1] as { tokens?: unknown }).tokens),
  )

/**
 * An agent's inline card, drawn with the app's own controls. What the person enters stays on this device until a button
 * sends it; when the agent changes the card, their entries stay unless the agent changed that same value.
 */
export function InlineUiCard({
  surface,
  sessionId,
  live,
}: {
  surface: InlineSurface
  sessionId: string
  live: boolean
}) {
  const language = useLanguage()
  const { id: hostId, invoke } = useHost()
  // Entries survive switching threads and restarting, as a message draft does.
  const [saved, setSaved] = useJsonDraft<SavedEdits>(
    `card:${sessionId}:${surface.surfaceId}`,
    hostId,
    [],
    isSavedEdits,
    (value) => value.length === 0,
  )
  const edits = useMemo<InlineUiEdits>(() => new Map(saved), [saved])
  const setEdits = (update: (current: InlineUiEdits) => InlineUiEdits) =>
    setSaved((current) => [...update(new Map(current))])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const previous = useRef(surface)
  useEffect(() => {
    if (previous.current.revision === surface.revision) return
    const before = previous.current.dataModel
    setSaved((current) => [...keepEdits(new Map(current), before, surface.dataModel)])
    previous.current = surface
  }, [surface, setSaved])
  const byId = useMemo(() => new Map(surface.components.map((c) => [c.id, c])), [surface.components])
  const model = useMemo(() => withEdits(surface.dataModel, edits), [surface.dataModel, edits])
  if (surface.deleted || !byId.has('root')) return null
  const locale = language === 'id' ? 'id-ID' : 'en-US'
  const context: Context = {
    surface,
    byId,
    model,
    locale,
    canAct: live,
    busy,
    write: (tokens, value) => setEdits((current) => new Map(current).set(editKey(tokens), { tokens, value })),
    press: (component, scope) => {
      const outcome = pressButton(surface, component, scope)
      if (outcome.kind === 'open')
        void onThisComputer('app.openExternal', outcome.url).catch((e) => setError(errorText(e)))
      if (outcome.kind !== 'event') return
      setBusy(component.id)
      setError(null)
      invoke('agent.inlineUiAction', sessionId, outcome.action)
        .catch((reason: unknown) => setError(errorText(reason)))
        .finally(() => setBusy(null))
    },
  }
  return (
    <section
      aria-label={t('Card from the agent')}
      className="flex max-w-[560px] flex-col gap-2 rounded-(--radius-m) p-3 [border:1px_solid_var(--line)]"
    >
      <Node id="root" scope={{ model, base: [], locale }} context={context} depth={0} />
      {error ? (
        <p role="alert" className="m-0 text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  )
}
