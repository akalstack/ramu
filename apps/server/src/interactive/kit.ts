import { icons } from 'lucide'

/**
 * Built-in pieces for generated documents, resolved when the document is previewed and published. The stored document
 * already contains the inlined SVG and CSS, so published versions never change when this kit changes and exported
 * source stays self-contained.
 *
 * Icons are Lucide (ISC License, Copyright (c) Lucide Contributors).
 */

const normalize = (name: string) => name.replace(/[-_\s]/g, '').toLowerCase()
const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
const ICONS = new Map(Object.entries(icons).map(([name, node]) => [normalize(name), { name: kebab(name), node }]))

/** Up to three known icon names closest to an unknown one. */
function suggest(name: string): string[] {
  const target = normalize(name)
  const distance = (a: string, b: string) => {
    let row = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
      const next = [i]
      for (let j = 1; j <= b.length; j++)
        next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
      row = next
    }
    return row[b.length]!
  }
  return [...ICONS]
    .map(([key, icon]) => ({ name: icon.name, score: key.includes(target) ? 0 : distance(target, key) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((icon) => icon.name)
}

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const has = (attrs: string, name: string) => new RegExp(`\\s${name}\\s*=`, 'i').test(attrs)
const ICON_DEFAULTS: [string, string][] = [
  ['xmlns', 'http://www.w3.org/2000/svg'],
  ['width', '1em'],
  ['height', '1em'],
  ['viewBox', '0 0 24 24'],
  ['fill', 'none'],
  ['stroke', 'currentColor'],
  ['stroke-width', '2'],
  ['stroke-linecap', 'round'],
  ['stroke-linejoin', 'round'],
]

function icon(attrs: string, name: string): string {
  const found = ICONS.get(normalize(name))
  if (!found)
    throw new Error(
      `Unknown icon "${name}". Lucide icon names are kebab-case; did you mean ${suggest(name).join(', ')}?`,
    )
  const labelled = has(attrs, 'aria-label') || has(attrs, 'aria-labelledby') || has(attrs, 'role')
  const extra = [...ICON_DEFAULTS, ...(labelled ? [] : [['aria-hidden', 'true'] as [string, string]])]
    .filter(([key]) => !has(attrs, key))
    .map(([key, value]) => ` ${key}="${value}"`)
    .join('')
  const children = found.node
    .map(
      ([tag, values]) =>
        `<${tag}${Object.entries(values)
          .map(([key, value]) => ` ${key}="${escape(String(value))}"`)
          .join('')}/>`,
    )
    .join('')
  return `<svg${attrs}${extra}>${children}</svg>`
}

/** Opt in with `<link rel="stylesheet" href="ramu:kit">`. Every rule uses :where() so the author's CSS always wins. */
export const INTERACTIVE_KIT_CSS = `
:where(h1,h2,h3,h4){margin:0 0 .5em;line-height:1.25;font-weight:600}:where(h1){font-size:20px}:where(h2){font-size:16px}:where(h3,h4){font-size:14px}
:where(p){margin:0 0 .75em}:where(a){color:var(--primary)}
:where(.stack){display:flex;flex-direction:column;gap:12px}:where(.row){display:flex;flex-wrap:wrap;align-items:center;gap:8px}
:where(.grid){display:grid;grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr));gap:12px}:where(.spacer){flex:1}
:where(.muted){color:var(--muted)}:where(.small){font-size:12px}:where(.mono){font-family:var(--font-mono)}:where(.num){font-variant-numeric:tabular-nums}
:where(.card){background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px}
:where(.btn,[role=tab]){display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:0 12px;border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);background:var(--surface-raised);color:var(--foreground);font:inherit;font-weight:500;cursor:pointer;text-decoration:none;white-space:nowrap}
:where(.btn:hover,[role=tab]:hover){background:color-mix(in srgb,var(--foreground) 10%,var(--surface-raised))}
:where(.btn[data-variant=primary]){background:var(--button);color:var(--button-foreground);border-color:transparent}:where(.btn[data-variant=primary]:hover){background:color-mix(in srgb,var(--button-foreground) 12%,var(--button))}
:where(.btn[data-variant=ghost]){background:transparent;border-color:transparent}:where(.btn[data-variant=danger]){color:var(--danger)}
:where(.btn[data-size=sm]){min-height:26px;padding:0 8px;font-size:12px}:where(.btn[data-size=icon]){width:32px;padding:0}
:where(.btn:disabled,.btn[aria-disabled=true]){opacity:.5;cursor:default}:where(.stack>.btn){align-self:flex-start}
:where(:focus-visible){outline:2px solid var(--primary);outline-offset:1px}
:where(input:not([type=checkbox],[type=radio],[type=range],[type=color],[type=file]),select,textarea){min-height:32px;padding:4px 10px;border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);background:var(--surface-raised);color:var(--foreground)}
:where(textarea){min-height:72px;resize:vertical}:where(input,select,textarea)::placeholder{color:var(--muted)}
:where(input[type=checkbox],input[type=radio],input[type=range],progress,meter){accent-color:var(--primary)}
:where(label){display:inline-flex;align-items:center;gap:6px}:where(.field){display:flex;flex-direction:column;align-items:flex-start;gap:4px}:where(.field>label,.label){color:var(--muted);font-size:12px;font-weight:500}
:where(.badge){display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:500;--tone:var(--muted);color:var(--tone);background:color-mix(in srgb,var(--tone) 14%,transparent)}
:where(.callout){padding:10px 12px;border-radius:calc(var(--radius) - 2px);border-left:3px solid var(--tone);--tone:var(--primary);background:color-mix(in srgb,var(--tone) 10%,transparent)}
:where([data-tone=primary]){--tone:var(--primary)}:where([data-tone=success]){--tone:var(--success)}:where([data-tone=warning]){--tone:var(--warning)}:where([data-tone=danger]){--tone:var(--danger)}
:where(.stat){display:flex;flex-direction:column;gap:2px}:where(.stat-label){color:var(--muted);font-size:12px}:where(.stat-value){font-size:24px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.2}:where(.stat-delta){font-size:12px;color:var(--tone,var(--muted))}
:where(.table){width:100%;border-collapse:collapse}:where(.table th){text-align:left;color:var(--muted);font-size:12px;font-weight:500}:where(.table th,.table td){padding:6px 8px;border-bottom:1px solid var(--border)}:where(.table td.num,.table th.num){text-align:right}
:where([role=tablist]){display:flex;gap:4px;flex-wrap:wrap}:where([role=tab][aria-selected=true]){background:var(--button);color:var(--button-foreground);border-color:transparent}
:where(.bar){height:6px;border-radius:999px;background:var(--surface-raised);overflow:hidden}:where(.bar>span){display:block;height:100%;background:var(--tone,var(--primary));border-radius:inherit}
:where(.dot){display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--tone,currentColor)}
:where(code:not(pre code),kbd){padding:.1em .35em;border-radius:4px;background:var(--code-background);font-size:.92em}:where(pre){margin:0;padding:12px;border-radius:calc(var(--radius) - 2px);background:var(--code-background);overflow:auto}
:where(hr){border:0;border-top:1px solid var(--border);margin:12px 0}
`
  .trim()
  .replace(/\n/g, '')

/**
 * Replace `<svg data-icon="name">` with the full Lucide icon and `<link rel="stylesheet" href="ramu:kit">` with the
 * kit stylesheet. Script, style, textarea and comment text is left untouched. Resolving an already-resolved document
 * gives the same result, so documents read back for revision can be previewed again unchanged.
 */
export function resolveInteractiveKit(html: string): string {
  const held: string[] = []
  const hold = (value: string) => `\u0000ramu-kit-${held.push(value) - 1}\u0000`
  return (
    html
      .replace(/<!--[\s\S]*?-->|<(script|style|textarea)\b[\s\S]*?<\/\1\s*>/gi, (match, tag?: string) => {
        if (tag?.toLowerCase() === 'script' && /^<script\b[^>]*\ssrc\s*=\s*["']?ramu:/i.test(match))
          throw new Error('ramu: built-ins are stylesheets and icons only; there is no ramu: script.')
        return hold(match)
      })
      .replace(/<link\b[^>]*\shref\s*=\s*(["']?)ramu:([^"'\s>]*)\1[^>]*>/gi, (_match, _q, name: string) => {
        if (name !== 'kit')
          throw new Error(`Unknown built-in ramu:${name}. Use <link rel="stylesheet" href="ramu:kit">.`)
        return `<style data-ramu-kit>${INTERACTIVE_KIT_CSS}</style>`
      })
      .replace(/<svg\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/gi, (match, attrs: string, selfClosing: string) => {
        const name = attrs
          .match(/\sdata-icon\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
          ?.slice(1)
          .find(Boolean)
        if (name === undefined) return match
        // The icon replaces the element's children; the closing tag marks where they end.
        return `${icon(attrs.replace(/\s+$/, ''), name)}${selfClosing ? '' : '\u0001'}`
      })
      // eslint-disable-next-line no-control-regex -- \u0001 marks where an icon.s children end
      .replace(/\u0001[\s\S]*?<\/svg\s*>/gi, '')
      // eslint-disable-next-line no-control-regex -- NUL delimits held placeholders; stripped input cannot contain it
      .replace(/\u0000ramu-kit-(\d+)\u0000/g, (_match, index: string) => held[Number(index)]!)
  )
}
