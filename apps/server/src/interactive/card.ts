// A Card artifact drawn on the host as plain HTML. The desktop and the phone draw a card natively with their own
// controls; this drawing serves what needs a page: preview screenshots, Versions, PDF, Publish to the web and Open to
// anyone. It has no script, so its controls show their starting values and do nothing.
import { ARTIFACT_SOURCE_FILES } from '@ramu/shared/artifacts'
import type { CardSource } from '@ramu/shared/artifactSource'
import {
  applyInlineUi,
  type InlineSurface,
  type InlineUiComponent,
  type InlineUiIcon,
} from '@ramu/shared/chat/inlineUi'
import {
  asBoolean,
  asNumber,
  asText,
  asTextList,
  childrenOf,
  evaluate,
  type InlineUiScope,
} from '@ramu/shared/chat/inlineUiRuntime'
import { inlineRuns } from '@ramu/shared/inlineMarks'
import { pageCapabilitiesOf } from './capabilities'
import { resolveInteractiveKit } from './kit'
import type { RenderedKind } from './kinds'

const LUCIDE: Record<InlineUiIcon, string> = {
  accountCircle: 'circle-user',
  add: 'plus',
  arrowBack: 'arrow-left',
  arrowForward: 'arrow-right',
  attachFile: 'paperclip',
  calendarToday: 'calendar-days',
  call: 'phone',
  camera: 'camera',
  check: 'check',
  close: 'x',
  delete: 'trash-2',
  download: 'download',
  edit: 'pencil',
  event: 'calendar',
  error: 'circle-alert',
  favorite: 'heart',
  folder: 'folder',
  help: 'circle-help',
  home: 'house',
  info: 'info',
  locationOn: 'map-pin',
  lock: 'lock',
  lockOpen: 'lock-open',
  mail: 'mail',
  menu: 'menu',
  moreHoriz: 'ellipsis',
  moreVert: 'ellipsis-vertical',
  notifications: 'bell',
  pause: 'pause',
  payment: 'credit-card',
  person: 'user',
  phone: 'smartphone',
  photo: 'image',
  play: 'play',
  print: 'printer',
  refresh: 'refresh-cw',
  search: 'search',
  send: 'send',
  settings: 'settings',
  share: 'share-2',
  shoppingCart: 'shopping-cart',
  star: 'star',
  stop: 'square',
  upload: 'upload',
  visibility: 'eye',
  visibilityOff: 'eye-off',
  warning: 'triangle-alert',
}

const CARD_CSS =
  '.ramu-card{max-width:560px;margin:0 auto;padding:16px;font-size:15px;line-height:1.5;color:var(--foreground)}' +
  '.ramu-card :where(p){margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.ramu-card .caption{font-size:13px;color:var(--muted)}' +
  '.ramu-card .col{display:flex;flex-direction:column;gap:8px;min-width:0}.ramu-card .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;min-width:0}' +
  '.ramu-card .box{padding:12px;border:1px solid var(--border);border-radius:10px}.ramu-card hr{border:0;border-top:1px solid var(--border);margin:4px 0;width:100%}' +
  '.ramu-card label{display:flex;flex-direction:column;gap:4px;min-width:0}.ramu-card label>span{font-size:13px;color:var(--muted)}' +
  '.ramu-card .check{flex-direction:row;align-items:center;gap:8px}.ramu-card .check>span{font-size:inherit;color:inherit}' +
  '.ramu-card input,.ramu-card textarea{font:inherit;color:inherit;background:var(--surface-raised);border:1px solid var(--border);border-radius:8px;padding:6px 8px}' +
  '.ramu-card button{font:inherit;color:inherit;background:var(--surface-raised);border:1px solid var(--border);border-radius:8px;padding:5px 12px}' +
  '.ramu-card button.primary,.ramu-card button[aria-checked=true]{background:var(--primary);color:var(--primary-foreground,#fff);border-color:transparent}' +
  '.ramu-card button.borderless{background:transparent;border-color:transparent}.ramu-card svg{width:16px;height:16px;flex:none}' +
  '.ramu-card .tabs{display:flex;gap:12px;border-bottom:1px solid var(--border);padding-bottom:4px;font-size:13px}.ramu-card .tabs>b{font-weight:600}'

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function rich(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      inlineRuns(line)
        .map((run) =>
          run.style === 'marker'
            ? ''
            : run.style === 'bold'
              ? `<strong>${escapeHtml(run.text)}</strong>`
              : run.style === 'italic'
                ? `<em>${escapeHtml(run.text)}</em>`
                : run.style === 'code'
                  ? `<code>${escapeHtml(run.text.replace(/^`+|`+$/g, ''))}</code>`
                  : escapeHtml(run.text),
        )
        .join(''),
    )
    .join('<br>')
}

function draw(byId: Map<string, InlineUiComponent>, id: string, scope: InlineUiScope, depth: number): string {
  const c = byId.get(id)
  if (!c || depth > 20) return ''
  const text = (value: unknown) => asText(evaluate(value, scope))
  const kids = (list: string[] | { componentId: string; path: string }) =>
    childrenOf(list, scope)
      .map((child) => draw(byId, child.id, { ...scope, base: child.base, index: child.index }, depth + 1))
      .join('')
  const one = (child: string) => draw(byId, child, scope, depth + 1)
  const label = (value: unknown) => (value === undefined ? '' : `<span>${escapeHtml(text(value))}</span>`)
  switch (c.component) {
    case 'Text':
      return `<p${c.variant === 'caption' ? ' class="caption"' : ''}>${rich(text(c.text))}</p>`
    case 'Icon': {
      const name = text(c.name) as InlineUiIcon
      return `<svg data-icon="${Object.hasOwn(LUCIDE, name) ? LUCIDE[name] : 'circle-help'}" aria-hidden="true"></svg>`
    }
    case 'Row':
      return `<div class="row">${kids(c.children)}</div>`
    case 'Column':
      return `<div class="col">${kids(c.children)}</div>`
    case 'List':
      return `<div class="${c.direction === 'horizontal' ? 'row' : 'col'}" role="list">${kids(c.children)}</div>`
    case 'Card':
      return `<div class="box">${one(c.child)}</div>`
    case 'Tabs':
      return `<div class="col"><div class="tabs">${c.tabs.map((tab, index) => (index ? `<span>${escapeHtml(text(tab.title))}</span>` : `<b>${escapeHtml(text(tab.title))}</b>`)).join('')}</div>${one(c.tabs[0]!.child)}</div>`
    case 'Divider':
      return '<hr>'
    case 'Button':
      return `<button type="button"${c.variant && c.variant !== 'default' ? ` class="${c.variant}"` : ''}>${one(c.child).replace(/<\/?p[^>]*>/g, '')}</button>`
    case 'TextField': {
      const value = escapeHtml(text(c.value))
      const placeholder = c.placeholder === undefined ? '' : ` placeholder="${escapeHtml(text(c.placeholder))}"`
      return `<label>${label(c.label)}${c.variant === 'longText' ? `<textarea rows="3"${placeholder}>${value}</textarea>` : `<input value="${value}"${placeholder}${c.variant === 'obscured' ? ' type="password"' : ''}>`}</label>`
    }
    case 'CheckBox':
      return `<label class="check"><input type="checkbox"${asBoolean(evaluate(c.value, scope)) ? ' checked' : ''}><span>${escapeHtml(text(c.label))}</span></label>`
    case 'ChoicePicker': {
      const selected = asTextList(evaluate(c.value, scope))
      return `<label>${label(c.label)}<div class="row" role="radiogroup">${c.options.map((option) => `<button type="button" aria-checked="${selected.includes(option.value)}">${escapeHtml(text(option.label))}</button>`).join('')}</div></label>`
    }
    case 'Slider': {
      const value = asNumber(evaluate(c.value, scope)) ?? c.min ?? 0
      return `<label>${label(c.label)}<input type="range" min="${c.min ?? 0}" max="${c.max}" value="${value}"></label>`
    }
    case 'DateTimeInput':
      return `<label>${label(c.label)}<input value="${escapeHtml(text(c.value))}"></label>`
  }
}

/** The card's state as every device reads it: the A2UI surface its messages build. */
export function cardSurface(source: CardSource): { surface: InlineSurface } | { error: string } {
  const collections = new Set(Object.keys(source.records ?? {}))
  const result = applyInlineUi(new Map(), source.messages, { collections })
  if (!result.ok) return { error: result.error }
  const live = result.surfaces.filter((surface) => !surface.deleted)
  if (live.length !== 1) return { error: 'A card artifact is one surface: send one createSurface and its updates.' }
  return { surface: live[0]! }
}

export function renderCard(source: CardSource, title: string): RenderedKind {
  const built = cardSurface(source)
  if ('error' in built) return { html: '<div class="ramu-card"></div>', files: [], problems: [built.error] }
  const { surface } = built
  const problems: string[] = []
  const files: RenderedKind['files'] = [{ path: ARTIFACT_SOURCE_FILES.card, content: JSON.stringify(surface) }]
  if (source.records) {
    const manifest = { path: 'ramu.json', content: JSON.stringify({ records: source.records }) }
    try {
      pageCapabilitiesOf({ files: [manifest] })
      files.push(manifest)
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error))
    }
  }
  // Records live on the host; the drawing shows each collection empty, as a new card starts.
  const model = {
    ...surface.dataModel,
    records: Object.fromEntries(Object.keys(source.records ?? {}).map((name) => [name, []])),
  }
  const byId = new Map(surface.components.map((c) => [c.id, c]))
  const body = draw(byId, 'root', { model, base: [], locale: 'en-US' }, 0)
  return {
    html: resolveInteractiveKit(
      `<style>${CARD_CSS}</style><div class="ramu-card" role="region" aria-label="${escapeHtml(title)}">${body}</div>`,
    ),
    files,
    problems,
  }
}
