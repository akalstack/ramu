import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'
import type { RenderOptions } from 'pele'
import { ARTIFACT_SOURCE_FILES, type DiagramFormat } from '@ramu/shared/artifacts'
import type { ArtifactSource } from '@ramu/shared/artifactSource'
import type { InteractiveFile } from '@ramu/shared/interactive'
import { renderDashboard } from './dashboard'
import { renderDesign } from './design'
import { renderMotion } from './motion'
import { INTERACTIVE_KIT_CSS } from './kit'
import { renderSlides } from './slides'
import { cleanSvg } from './svg'

/** What a Doc, Diagram or deck becomes: the HTML the frame runs, the files its version keeps, and what its checks found. */
export interface RenderedKind {
  html: string
  files: InteractiveFile[]
  problems: string[]
}

// Pele's colors follow the frame's theme tokens, the same mapping chat diagrams use, so a drawing switches between
// light and dark without being drawn again.
const DIAGRAM_CSS =
  ':root{--pele-bg:var(--background);--pele-fg:var(--foreground);--pele-muted:var(--muted);--pele-line:color-mix(in srgb,var(--foreground) 55%,var(--background));--pele-surface:var(--surface-raised);--pele-surface-alt:color-mix(in srgb,var(--primary) 14%,var(--surface-raised));--pele-border:color-mix(in srgb,var(--foreground) 28%,var(--background));--pele-accent:var(--primary);--pele-critical:var(--danger);--pele-error:var(--danger);--pele-font:var(--font-sans);--pele-font-mono:var(--font-mono);--pele-radius:6px;--pele-series-1:var(--chart-1);--pele-series-2:var(--chart-2);--pele-series-3:var(--chart-3);--pele-series-4:var(--chart-4);--pele-series-5:var(--chart-5);--pele-series-6:var(--chart-6);--pele-series-7:#e0609a;--pele-series-8:#8e8e96}' +
  '.ramu-diagram{display:flex;justify-content:center;margin:0 0 1em;overflow-x:auto}.ramu-diagram>svg{max-width:100%;height:auto}'
const DOC_CSS =
  '.ramu-doc{max-width:720px;margin:0 auto;font-size:15px;line-height:1.65}' +
  '.ramu-doc :where(h1,h2,h3,h4,h5,h6){margin:1.4em 0 .5em;scroll-margin-top:12px}.ramu-doc>:first-child{margin-top:0}' +
  '.ramu-doc h1{font-size:24px}.ramu-doc h2{font-size:19px}.ramu-doc h3{font-size:16px}.ramu-doc :where(h4,h5,h6){font-size:15px}' +
  '.ramu-doc :where(p,ul,ol,blockquote,pre,.ramu-table){margin:0 0 .9em}.ramu-doc :where(ul,ol){padding-left:1.4em}.ramu-doc li+li{margin-top:.25em}' +
  '.ramu-doc li>input[type=checkbox]{margin:0 .4em 0 -1.3em}.ramu-doc li:has(>input[type=checkbox]){list-style:none}' +
  '.ramu-doc blockquote{padding:0 0 0 12px;border-left:3px solid var(--border);color:var(--muted)}' +
  '.ramu-doc .ramu-table{overflow-x:auto}.ramu-doc img{max-width:100%}.ramu-doc .footnotes{font-size:13px;color:var(--muted)}' +
  '.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}'

const decodeHtml = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|#39);/g, (_m, name: string) =>
    name === 'amp' ? '&' : name === 'lt' ? '<' : name === 'gt' ? '>' : name === 'quot' ? '"' : "'",
  )
const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A GitHub-style anchor: lowercase letters and digits, words joined by hyphens. */
function anchorOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

/**
 * Mermaid drawn on the host with Pele: links and images are off and the result goes through the SVG cleaner, so a
 * drawing holds no way out of the frame. Pele loads only when a diagram is drawn.
 */
async function drawMermaid(source: string): Promise<string> {
  const pele = await import('pele')
  const options: RenderOptions = {
    links: false,
    images: false,
    // Keep the author's direction; a wide diagram scales down to fit instead of turning vertical.
    autoDirection: false,
  }
  return cleanSvg(pele.render(source, options).svg).svg
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)).trim()

async function renderDoc(markdown: string): Promise<RenderedKind> {
  const problems: string[] = []
  // Raw HTML in the Markdown is shown as text, and unsafe link protocols are dropped, by micromark's defaults.
  let html = micromark(markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] })
  const blocks = [...html.matchAll(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g)]
  const drawn = await Promise.all(
    blocks.map(async (match, index) => {
      try {
        return `<figure class="ramu-diagram" role="img" aria-label="Diagram ${index + 1}">${await drawMermaid(decodeHtml(match[1]!))}</figure>`
      } catch (error) {
        problems.push(`Diagram ${index + 1} could not be drawn: ${reason(error)}`)
        return match[0]
      }
    }),
  )
  let block = 0
  html = html.replace(/<pre><code class="language-mermaid">[\s\S]*?<\/code><\/pre>/g, () => drawn[block++]!)
  // Every heading gets an anchor, so the outline and links can reach it; one without text or with a twin cannot.
  const anchors = new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((match) => decodeHtml(match[1]!)))
  let heading = 0
  html = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (match, level: string, inner: string) => {
    heading++
    const text = decodeHtml(inner.replace(/<[^>]*>/g, '')).trim()
    if (!text) {
      problems.push(`Heading ${heading} is empty. Give it text or remove it.`)
      return match
    }
    const anchor = anchorOf(text) || `section-${heading}`
    if (anchors.has(anchor)) {
      problems.push(`Two headings share the anchor #${anchor} ("${text}"). Give one a different name.`)
      return match
    }
    anchors.add(anchor)
    return `<h${level} id="${escapeHtml(anchor)}">${inner}</h${level}>`
  })
  for (const match of html.matchAll(/\shref="#([^"]*)"/g)) {
    const target = decodeHtml(match[1]!)
    if (!anchors.has(target)) problems.push(`The link to #${target} has no heading or note to go to.`)
  }
  html = html.replace(/<table>([\s\S]*?)<\/table>/g, '<div class="ramu-table"><table class="table">$1</table></div>')
  return {
    html: `<style>${INTERACTIVE_KIT_CSS}${DIAGRAM_CSS}${DOC_CSS}</style><article class="ramu-doc">${html}</article>`,
    files: [{ path: ARTIFACT_SOURCE_FILES.doc, content: markdown }],
    problems: [...new Set(problems)].slice(0, 20),
  }
}

async function renderDiagram(format: DiagramFormat, source: string, title: string): Promise<RenderedKind> {
  const label = escapeHtml(title)
  const page = (svg: string) =>
    `<style>${DIAGRAM_CSS}</style><figure class="ramu-diagram" role="img" aria-label="${label}">${svg}</figure>`
  if (format === 'svg') {
    const clean = cleanSvg(source)
    return {
      html: page(clean.svg),
      files: [{ path: ARTIFACT_SOURCE_FILES.svg, content: clean.svg }],
      problems: clean.removed.length
        ? [`The SVG uses ${clean.removed.join(', ')}, which diagrams do not allow. Remove them.`]
        : [],
    }
  }
  try {
    const svg = await drawMermaid(source)
    return {
      html: page(svg),
      files: [
        { path: ARTIFACT_SOURCE_FILES.mermaid, content: source },
        { path: ARTIFACT_SOURCE_FILES.svg, content: svg },
      ],
      problems: [],
    }
  } catch (error) {
    return {
      html: page(''),
      files: [{ path: ARTIFACT_SOURCE_FILES.mermaid, content: source }],
      problems: [`The diagram does not parse: ${reason(error)}`],
    }
  }
}

/**
 * Draws a Doc, Diagram or deck as the HTML the sandboxed frame runs. It has no script and loads nothing; a deck's images
 * come from `files`.
 */
export async function renderArtifactSource(
  source: ArtifactSource,
  title: string,
  files: InteractiveFile[] = [],
): Promise<RenderedKind> {
  if (source.kind === 'slides') return renderSlides(source, title, files)
  if (source.kind === 'dashboard') return renderDashboard(source, title)
  if (source.kind === 'design') return renderDesign(source, title)
  if (source.kind === 'motion') return renderMotion(source, title)
  return source.kind === 'doc' ? renderDoc(source.source) : renderDiagram(source.format, source.source, title)
}
