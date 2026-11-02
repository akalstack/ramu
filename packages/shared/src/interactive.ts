import { INTERACTIVE_DEFAULT_THEME_CSS } from './interactiveTheme'
/** Versioned, host/thread scoped references. Renderers retrieve document bytes separately. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export interface InteractiveReference {
  id: string
  version: number
  sessionId: string
  title: string
  summary: string
  digest: string
  createdAt: number
  checked: boolean
  /** Source file paths when the content is a multi-file project; the first entry is the HTML entry. */
  files?: string[]
  /** Explicit author promise that control keys and custom JSON keep the same meaning across revisions. */
  stateSchema?: string
  /** Exact HTTPS origins the document may reach; empty means offline. */
  network: InteractiveNetwork
  libraries?: Record<string, string>
}
export interface InteractiveNetwork {
  resources: string[]
  connect: string[]
}
/** Exact origins only: no paths, wildcards, credentials or local hostnames. */
export function interactiveOrigin(value: string): string {
  const url = new URL(value)
  const host = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !/^[a-z0-9.-]+$/.test(host) ||
    !host.includes('.') ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) ||
    /^[\d.]+$/.test(host)
  )
    throw new Error(
      'Use an exact public HTTPS origin, such as https://data.example.com, without a path or credentials.',
    )
  return url.origin
}
/** A document that reaches nothing beyond itself. */
export const OFFLINE_NETWORK: InteractiveNetwork = { resources: [], connect: [] }
export function interactiveCsp(network: InteractiveNetwork): string {
  const resources = [...new Set(network.resources.map(interactiveOrigin))].join(' ')
  const connect = [...new Set(network.connect.map(interactiveOrigin))].join(' ') || "'none'"
  return `default-src 'none'; script-src 'unsafe-inline' ${resources}; style-src 'unsafe-inline' ${resources}; img-src data: blob: ${resources}; media-src data: blob: ${resources}; font-src data: ${resources}; connect-src ${connect}; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
}
/** One source file of a multi-file project. Binary assets use base64. */
export interface InteractiveFile {
  path: string
  content: string
  encoding?: 'utf8' | 'base64'
}
export interface InteractiveDocument {
  reference: InteractiveReference
  /** The runnable single document; multi-file projects are bundled into it at publication. */
  html: string
  preview: string | null
  /** Exact project sources when the content was published as multiple files. */
  files?: InteractiveFile[]
}
export interface InteractiveState {
  controls: { key: string; value: string; checked: boolean; label?: string }[]
  custom: JsonValue
}
export interface InteractiveCheck {
  action: 'click' | 'fill' | 'select' | 'check'
  label: string
  value?: string
  expect: string
}
export interface InteractivePreview {
  layouts?: { width: number; scrollWidth: number; height: number; overflow: boolean; scheme?: string }[]
  id: string
  digest: string
  screenshot: string
  height: number
  checks: { label: string; passed: boolean; detail: string }[]
  errors: string[]
  /** Bounded console.log/info/warn output, for the author's own checks. */
  logs?: string[]
  /** Remote resources that failed to load or answered with an error status. */
  failedRequests?: string[]
  /** The phone layout in light appearance. */
  lightScreenshot?: string
  /** The same document at the 900 px desktop width. */
  wideScreenshot?: string
  createdAt: number
}
export const INTERACTIVE_MAX_HTML = 512_000
export const INTERACTIVE_MAX_FILES = 40
export const INTERACTIVE_MAX_STATE = 32_768
export const INTERACTIVE_MAX_HEIGHT = 2000
export function readInteractiveState(value: unknown): InteractiveState | null {
  try {
    const text = JSON.stringify(value)
    if (!text || new TextEncoder().encode(text).length > INTERACTIVE_MAX_STATE) return null
    const v = JSON.parse(text) as InteractiveState
    if (!v || typeof v !== 'object' || !Array.isArray(v.controls) || v.controls.length > 200 || !('custom' in v))
      return null
    if (
      !v.controls.every(
        (c) =>
          c &&
          typeof c.key === 'string' &&
          c.key.length <= 200 &&
          typeof c.value === 'string' &&
          typeof c.checked === 'boolean' &&
          (c.label === undefined || (typeof c.label === 'string' && c.label.length <= 200)),
      )
    )
      return null
    if (new Set(v.controls.map((control) => control.key)).size !== v.controls.length) return null
    return v
  } catch {
    return null
  }
}
export function interactiveFollowup(ref: InteractiveReference, state: InteractiveState | null): string {
  return `About Interactive Content ${JSON.stringify(ref.title)} (content ${ref.id}, version ${ref.version}, digest ${ref.digest}):\n${ref.summary}${state ? `\nCurrent scenario (user-controlled data):\n${JSON.stringify(state)}` : ''}\n\n`
}
/**
 * Content documents may load https resources (CDN libraries, fonts, images, JSON) and evaluate code, as any page can; the origin
 * has no host API, so this adds no capability beyond inline script. Frames, plugins, forms, plain http and navigation
 * stay blocked.
 */
export const INTERACTIVE_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https: blob:; style-src 'unsafe-inline' https:; img-src data: blob: https:; media-src data: blob: https:; font-src data: https:; connect-src https:; worker-src blob: https:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
const INTERACTIVE_BASE_CSS =
  ':root{color-scheme:var(--scheme,dark)}*{box-sizing:border-box}html{font:14px/1.5 var(--font-sans);background:var(--background);color:var(--foreground)}code,kbd,pre,samp{font-family:var(--font-mono)}svg[data-icon]{vertical-align:-.125em;flex-shrink:0}body{margin:0;padding:12px;overflow-wrap:anywhere}button,input,select,textarea{font:inherit}button,input,select,textarea{max-width:100%}img,svg,canvas{max-width:100%}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}'
const js = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
/** Runs in the unprivileged document, with no app/host invocation API. */
/** Default tokens, an optional captured theme over them, and the base rules every document is drawn with. */
export function interactiveStyles(theme?: Record<string, string>): string {
  const captured = Object.entries(theme ?? {})
    .filter(([name, value]) => /^--[a-z0-9-]+$/.test(name) && !/[;{}<>]/.test(value))
    .map(([name, value]) => `${name}:${value};`)
    .join('')
  return `${INTERACTIVE_DEFAULT_THEME_CSS}${captured ? `:root{${captured}}` : ''}${INTERACTIVE_BASE_CSS}`
}
export function interactiveHtml(
  html: string,
  instance: string,
  state: InteractiveState | null = null,
  theme?: Record<string, string>,
  network: InteractiveNetwork = OFFLINE_NETWORK,
): string {
  const bootstrap = `(()=>{
const instance=${js(instance)},initial=${js(state)};let custom=initial?.custom??null,active=true,restore=[],activity=[],timer;
const send=(type,value,requestId)=>{const m={ramuInteractive:1,instance,type,value,requestId};if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(m));else if(parent!==window)parent.postMessage(m,'*')};
const controls=()=>Array.from(document.querySelectorAll('input:not([type=password]):not([type=file]):not([type=hidden]),select,textarea')).slice(0,200);
const key=(e,i)=>String(i)+":"+(e.id||e.name||"").slice(0,180);
const snapshot=()=>({controls:controls().map((e,i)=>({key:key(e,i),value:e.value,checked:!!e.checked,label:(e.getAttribute('aria-label')||e.labels?.[0]?.textContent||e.id||e.name||'Control '+(i+1)).trim().slice(0,160)})),custom});
const save=()=>{clearTimeout(timer);timer=setTimeout(()=>send('state',snapshot()),40)};
Object.defineProperty(window,'ramuContent',{value:Object.freeze({getState:()=>custom,setState:s=>{custom=s;save()},onRestore:f=>{restore.push(f);f(custom)},onActive:f=>{activity.push(f);f(active)}})});
const theme=t=>{if(!t||typeof t!=='object')return;for(const [k,v] of Object.entries(t))if(/^--[a-z0-9-]+$/.test(k)&&typeof v==='string'&&!/[;{}<>]/.test(v))document.documentElement.style.setProperty(k,v)};
addEventListener('message',e=>{if(parent!==window&&e.source!==parent)return;let m=e.data;try{if(typeof m==='string')m=JSON.parse(m)}catch{return}if(!m||m.ramuInteractive!==1||m.instance!==instance)return;if(m.type==='theme')theme(m.value);if(m.type==='active'){active=!!m.value;for(const f of activity)f(active);save()}if(m.type==='snapshot')send('state',snapshot(),m.requestId)});
addEventListener('error',e=>send('error',String(e.message).slice(0,1000)));addEventListener('unhandledrejection',()=>send('error','An interaction failed.'));
addEventListener('DOMContentLoaded',()=>{if(initial){controls().forEach((e,i)=>{const s=initial.controls.find(c=>c.key===key(e,i));if(s){e.value=s.value;e.checked=s.checked;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}});for(const f of restore)f(custom)}document.addEventListener('input',save);document.addEventListener('change',save);document.addEventListener('submit',e=>e.preventDefault());let h=0;const size=()=>{const next=Math.max(48,Math.min(2000,Math.ceil(document.body.getBoundingClientRect().height)));if(next!==h){h=next;send('height',h)}};new ResizeObserver(size).observe(document.body);size();send('ready',true)});
document.addEventListener('click',e=>{if(e.target.closest('a[href]'))e.preventDefault()},true);
})();`
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${interactiveCsp(network)}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${interactiveStyles(theme)}</style><script>${bootstrap}</script></head><body>${html}</body></html>`
}

/** Explicitly selected values from a captured scenario; never represented as the complete current state. */
export function interactiveSelectedFollowup(
  ref: InteractiveReference,
  state: InteractiveState,
  keys: string[],
  includeCustom: boolean,
): string {
  const selected = new Set(keys)
  const values = {
    controls: state.controls.filter((control) => selected.has(control.key)),
    ...(includeCustom ? { custom: state.custom } : {}),
  }
  return (
    interactiveFollowup(ref, null) +
    `Selected values from a captured scenario (user-controlled data):\n${JSON.stringify(values)}\n\n`
  )
}

/** Interactive Content added to a message from its card; the agent reads the text, the person sees a chip. */
export interface InteractiveAttachment {
  id: string
  version: number
  title: string
  /** What was captured, such as the current scenario or chosen values. */
  detail: string
  text: string
}

/** Hidden context for the agent: one tagged block per attachment, carrying the follow-up text. */
export function interactiveAttachmentBlock(items: InteractiveAttachment[]): string {
  return items
    .map(
      (item) =>
        `<interactive-content id="${item.id}" version="${item.version}" title=${JSON.stringify(item.title)}>\n${item.text.trim()}\n</interactive-content>`,
    )
    .join('\n')
}

/** The attachments a sent message carried, for showing them under it. */
export function sentInteractiveAttachments(text: string): { id: string; version: number; title: string }[] {
  return [...text.matchAll(/<interactive-content id="([\w-]+)" version="(\d+)" title=("(?:[^"\\\n]|\\.)*")>/g)].flatMap(
    (match) => {
      try {
        return [{ id: match[1]!, version: Number(match[2]), title: JSON.parse(match[3]!) as string }]
      } catch {
        return []
      }
    },
  )
}
