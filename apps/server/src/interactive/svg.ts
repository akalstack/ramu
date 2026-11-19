/**
 * An allowlist SVG cleaner for Diagram artifacts. The source is tokenized and written out again from the tokens, so
 * only drawing elements and plain attributes survive: no script, event handlers, links, foreign HTML, external images
 * or styles that fetch. Exported SVG files open on their own outside the sandboxed frame, so this is their only guard.
 */

const ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'style',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'pattern',
  'clipPath',
  'mask',
  'marker',
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feDistantLight',
  'feDropShadow',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'fePointLight',
  'feSpecularLighting',
  'feSpotLight',
  'feTile',
  'feTurbulence',
])
const ATTRIBUTE = /^[a-zA-Z_][\w.:-]*$/
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

const decode = (text: string) =>
  text.replace(/&(#\d{1,7}|#x[\da-f]{1,6}|[a-z]+);/gi, (match, name: string) => {
    if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? match
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
  })
const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttribute = (text: string) => escapeText(text).replace(/"/g, '&quot;')
/** CSS that could fetch or run something; only references inside the drawing (url(#id)) are kept. */
const unsafeCss = (css: string) =>
  /@import|expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(css) || /url\(\s*(?!['"]?#)/i.test(css)

export interface CleanSvg {
  svg: string
  /** What was left out, in words an author can act on; empty when the source was already clean. */
  removed: string[]
}

/** Cleans one `<svg>` document. Markup that cannot be read as SVG throws with the reason. */
export function cleanSvg(source: string): CleanSvg {
  const removed = new Set<string>()
  const out: string[] = []
  const stack: string[] = []
  // While inside a dropped element, its whole subtree is skipped.
  let skipping = 0
  let roots = 0
  const token =
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!([^>]*)>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g
  let at = 0
  const text = (value: string) => {
    if (skipping || !value) return
    if (!stack.length) {
      if (value.trim()) throw new Error('Put everything inside one <svg> element.')
      return
    }
    out.push(escapeText(decode(value)))
  }
  for (let match = token.exec(source); match; match = token.exec(source)) {
    const between = source.slice(at, match.index)
    if (between.includes('<'))
      throw new Error(
        `The SVG has markup that cannot be read near "${between.slice(between.indexOf('<'), between.indexOf('<') + 40)}".`,
      )
    text(between)
    at = token.lastIndex
    const [whole, cdata, declaration, closing, opening, attrs = '', selfClosing] = match
    if (whole.startsWith('<!--') || whole.startsWith('<?')) continue
    if (cdata !== undefined) {
      text(cdata.replace(/&/g, '&amp;'))
      continue
    }
    if (declaration !== undefined) throw new Error('Remove the <!DOCTYPE> or other declaration from the SVG.')
    if (closing !== undefined) {
      const open = stack.pop()
      if (open !== closing) throw new Error(`The SVG closes </${closing}> where <${open ?? 'nothing'}> is open.`)
      if (skipping) skipping--
      else out.push(`</${closing}>`)
      continue
    }
    const name = opening!
    const root = !stack.length
    if (root) {
      roots++
      if (name !== 'svg' || roots > 1) throw new Error('Put everything inside one <svg> element.')
    }
    const keep = !skipping && ELEMENTS.has(name)
    if (!skipping && !keep) removed.add(`<${name}> elements`)
    if (!selfClosing) {
      stack.push(name)
      if (!keep) skipping++
    }
    if (!keep) continue
    const kept: string[] = []
    for (const attr of attrs.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) {
      const attribute = attr[1]!
      const value = decode(attr[2] ?? attr[3] ?? '')
      const lower = attribute.toLowerCase()
      if (!ATTRIBUTE.test(attribute) || lower.startsWith('on')) {
        removed.add(`${attribute} attributes`)
        continue
      }
      if ((lower === 'href' || lower === 'xlink:href') && !value.trim().startsWith('#')) {
        removed.add('links to other files or pages')
        continue
      }
      if (lower === 'src' || lower === 'srcset' || unsafeCss(value)) {
        removed.add(`${attribute} values that load from elsewhere`)
        continue
      }
      kept.push(` ${attribute}="${escapeAttribute(value)}"`)
    }
    if (name === 'style' && !selfClosing) {
      // Style text is read up to its closing tag as one piece, so a selector like a > b is not taken for markup.
      const end = source.indexOf('</style', at)
      if (end < 0) throw new Error('The SVG has a <style> element that is never closed.')
      const css = decode(source.slice(at, end).replace(/<!\[CDATA\[|\]\]>/g, ''))
      at = end
      token.lastIndex = end
      if (unsafeCss(css)) {
        removed.add('styles that load from elsewhere')
        out.push(`<style${kept.join('')}>`)
        continue
      }
      out.push(`<style${kept.join('')}>${escapeText(css)}`)
      continue
    }
    // A file opened on its own is only drawn as SVG with the namespace on its root.
    if (root && !kept.some((attr) => attr.startsWith(' xmlns='))) kept.unshift(' xmlns="http://www.w3.org/2000/svg"')
    out.push(`<${name}${kept.join('')}${selfClosing ? '/>' : '>'}`)
  }
  const rest = source.slice(at)
  if (rest.includes('<')) throw new Error('The SVG has markup that cannot be read at its end.')
  text(rest)
  if (stack.length) throw new Error(`The SVG never closes <${stack.at(-1)}>.`)
  if (!roots) throw new Error('The source has no <svg> element.')
  return { svg: out.join(''), removed: [...removed] }
}
