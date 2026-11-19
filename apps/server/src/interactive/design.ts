// A Design drawn on the host: named frames at their true size side by side on a canvas that scrolls sideways, each with its own markup and styles.
// A frame's styles are scoped to it with @scope, so one frame cannot restyle another; content that spills past a
// frame's edges is clipped and reported by the preview's fit check.
import { ARTIFACT_SOURCE_FILES } from '@ramu/shared/artifacts'
import { designTokenCss, type DesignSource } from '@ramu/shared/artifactSource'
import type { InteractiveFile } from '@ramu/shared/interactive'
import type { RenderedKind } from './kinds'

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const DESIGN_CSS =
  '.ramu-canvas{display:flex;flex-wrap:wrap;gap:32px;align-items:flex-start;overflow-x:auto;padding-bottom:8px;font-family:var(--font-sans)}' +
  '.ramu-frame-wrap{display:flex;flex-direction:column;gap:8px;flex:none}' +
  '.ramu-frame-wrap>span{color:var(--muted);font-size:13px}' +
  '.ramu-frame{position:relative;overflow:hidden;background:var(--background);color:var(--foreground);border:1px solid var(--border);border-radius:8px;flex:none}'

const FONT_TYPES: Record<string, string> = { woff2: 'woff2', woff: 'woff', ttf: 'ttf', otf: 'otf' }

/** The design's tokens with each named font file read in as data, and the problems with any that are missing. */
function withFontData(design: DesignSource, files: InteractiveFile[]) {
  const problems: string[] = []
  if (!design.tokens?.fonts?.length) return { tokens: design.tokens, problems }
  const fonts = design.tokens.fonts.map((font) => {
    if (font.data || !font.path) return font
    const file = files.find((entry) => entry.path === font.path && entry.encoding === 'base64')
    const type = FONT_TYPES[font.path.split('.').pop()?.toLowerCase() ?? '']
    if (!file || !type) {
      problems.push(`${font.path} is not a WOFF2, WOFF, TTF or OTF file sent in files with encoding base64.`)
      return font
    }
    const { path: _path, ...rest } = font
    return { ...rest, data: `data:font/${type};base64,${file.content}` }
  })
  return { tokens: { ...design.tokens, fonts }, problems }
}

export function renderDesign(design: DesignSource, title: string, files: InteractiveFile[] = []): RenderedKind {
  const { tokens, problems } = withFontData(design, files)
  const frames = design.frames.map((frame, index) => {
    // A closing tag inside the author's styles could end the style element early; it is escaped away.
    const css = frame.css
      ? `<style>@scope ([data-ramu-frame="${index}"]) {${frame.css.replace(/<\//g, '<\\/')}}</style>`
      : ''
    return (
      `<div class="ramu-frame-wrap"><span>${escapeHtml(frame.name)}</span>` +
      `<section class="ramu-frame" data-ramu-frame="${index}" data-ramu-frame-name="${escapeHtml(frame.name)}" data-ramu-fit="Frame ${escapeHtml(frame.name)}" style="width:${frame.width}px;height:${frame.height}px" aria-label="${escapeHtml(frame.name)}">` +
      `${css}${frame.html}</section></div>`
    )
  })
  return {
    html: `${tokens ? designTokenCss(tokens) : ''}<style>${DESIGN_CSS}</style><div class="ramu-canvas" role="region" aria-label="${escapeHtml(title)}">${frames.join('')}</div>`,
    files: [
      {
        path: ARTIFACT_SOURCE_FILES.design,
        content: JSON.stringify({ frames: design.frames, ...(tokens ? { tokens } : {}) }),
      },
    ],
    problems,
  }
}
