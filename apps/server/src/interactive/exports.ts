import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { chromium, type Page } from 'playwright-core'
import { ARTIFACT_SOURCE_FILES, artifactKind } from '@ramu/shared/artifacts'
import { parseArtifactSource, type SlidesSource } from '@ramu/shared/artifactSource'
import { interactiveCsp, interactiveHtml, type InteractiveDocument } from '@ramu/shared/interactive'
import {
  exportFileName,
  hostExportFormats,
  type ExportedFile,
  type HostExportFormat,
} from '@ramu/shared/interactiveExport'
import type { Db } from '../db'
import { ensureInteractiveBrowser } from './browser'
import { writeDocx } from './docx'
import { writePptx } from './pptx'

/** An export travels to the device in one message; past this it would not fit. */
const EXPORT_MAX_BYTES = 10_000_000
/** Kept exports across every artifact; the oldest go first. */
const KEPT_EXPORTS = 40

const MIME: Record<HostExportFormat, string> = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  webm: 'video/webm',
}

function deckOf(document: InteractiveDocument): SlidesSource {
  const source = document.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.slides)?.content
  if (!source) throw new Error('This deck version has no slide list. Ask the agent to publish it again.')
  const deck = parseArtifactSource({ kind: 'slides', ...(JSON.parse(source) as object) })
  if (deck.kind !== 'slides') throw new Error('This version is not a deck.')
  return deck
}

function docOf(document: InteractiveDocument): string {
  const source = document.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.doc)?.content
  if (source === undefined)
    throw new Error('This doc version has no Markdown source. Ask the agent to publish it again.')
  return source
}

/**
 * Opens a version's exact HTML in the sandboxed browser with nothing reachable: its own bytes are served and every
 * other request is refused, so an export never reaches the network. Light mode, as on paper.
 */
async function withPage<T>(
  document: InteractiveDocument,
  viewport: { width: number; height: number },
  scale: number,
  work: (page: Page) => Promise<T>,
  limitMs = 90_000,
): Promise<T> {
  const executablePath = await ensureInteractiveBrowser()
  const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true, timeout: 10_000 })
  const timer = setTimeout(() => void browser.close().catch(() => {}), limitMs)
  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: scale,
      serviceWorkers: 'block',
      acceptDownloads: false,
      reducedMotion: 'reduce',
      colorScheme: 'light',
    })
    const source = interactiveHtml(document.html, 'export', null, undefined, document.reference.network)
    await context.route('**/*', (route) =>
      route.request().isNavigationRequest() && route.request().url() === 'https://ramu-content.invalid/'
        ? route.fulfill({
            body: source,
            contentType: 'text/html',
            headers: {
              'Content-Security-Policy': `${interactiveCsp(document.reference.network)}; sandbox allow-scripts`,
            },
          })
        : route.abort('blockedbyclient'),
    )
    await context.routeWebSocket('**/*', (socket) => socket.close())
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    page.on('dialog', (dialog) => void dialog.dismiss())
    await page.goto('https://ramu-content.invalid/', { waitUntil: 'load', timeout: 20_000 })
    // An app draws after load; a moment lets its first frame settle before it is printed.
    await page.evaluate('document.fonts.ready.then(()=>new Promise(r=>setTimeout(r,300)))')
    return await work(page)
  } catch (error) {
    throw new Error('Could not make this export in the host’s browser. Try again.', { cause: error })
  } finally {
    clearTimeout(timer)
    await browser.close().catch(() => {})
  }
}

/** Every version printed as the reader sees it: a deck one slide per 16:9 page, everything else on A4. */
function printPdf(document: InteractiveDocument): Promise<Buffer> {
  const slides = document.reference.kind === 'slides'
  return withPage(document, { width: slides ? 1280 : 900, height: 900 }, 1, (page) =>
    page.pdf(
      slides
        ? { preferCSSPageSize: true, printBackground: true }
        : {
            format: 'A4',
            printBackground: true,
            margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
          },
    ),
  )
}

/** A diagram or dashboard as one PNG at twice its drawn size, on the page's own background. */
function pictureImage(document: InteractiveDocument): Promise<Buffer> {
  const selector =
    document.reference.kind === 'dashboard'
      ? '.ramu-dashboard'
      : document.reference.kind === 'motion'
        ? '.ramu-motion'
        : '.ramu-diagram'
  return withPage(document, { width: 1200, height: 900 }, 2, (page) =>
    page.locator(selector).first().screenshot({ type: 'png', animations: 'disabled' }),
  )
}

/** One PNG per design frame at twice its size, numbered and named, in one zip. */
function frameImages(document: InteractiveDocument): Promise<Buffer> {
  return withPage(document, { width: 1440, height: 900 }, 2, async (page) => {
    const frames = page.locator('[data-ramu-frame]')
    const count = await frames.count()
    const zip = new JSZip()
    const digits = String(count).length
    for (let index = 0; index < count; index++) {
      const name = ((await frames.nth(index).getAttribute('data-ramu-frame-name')) ?? '')
        .replace(/[^\w .-]+/g, '')
        .trim()
        .slice(0, 60)
      zip.file(
        `${String(index + 1).padStart(digits, '0')}${name ? ` ${name}` : ''}.png`,
        await frames.nth(index).screenshot({ animations: 'disabled' }),
      )
    }
    return zip.generateAsync({ type: 'nodebuffer' })
  })
}

const require = createRequire(import.meta.url)
const VIDEO_FPS = 12

/**
 * A motion as a WebM video: its CSS animations are paused and stepped to each frame's exact time with the Web
 * Animations API, so frames never depend on how fast the browser is, then encoded with the browser's own WebCodecs
 * (VP9) and packaged by Mediabunny in a blank page that the artifact never touches. No ffmpeg is involved.
 */
function motionVideo(document: InteractiveDocument): Promise<Buffer> {
  const stored = document.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.motion)?.content
  if (!stored) throw new Error('This motion version has no scenes. Ask the agent to publish it again.')
  const seconds = (JSON.parse(stored) as { scenes: { seconds: number }[] }).scenes.reduce(
    (total, scene) => total + scene.seconds,
    0,
  )
  const frames = Math.ceil(seconds * VIDEO_FPS)
  return withPage(
    document,
    { width: 1280, height: 720 },
    1,
    async (page) => {
      await page.addStyleTag({
        content: 'html body{margin:0;padding:0}html body .ramu-motion{max-width:none;border:0;border-radius:0}',
      })
      await page.evaluate('document.getAnimations().forEach((a) => a.pause())')
      const stage = page.locator('.ramu-motion').first()
      // WebCodecs needs a secure page: the encoder gets an https address the browser answers itself, offline.
      await page
        .context()
        .route('https://ramu-encoder.invalid/', (route) =>
          route.fulfill({ body: '<!doctype html><title>encode</title>', contentType: 'text/html' }),
        )
      const encoder = await page.context().newPage()
      await encoder.goto('https://ramu-encoder.invalid/')
      await encoder.addScriptTag({
        content: `var module={exports:{}};var exports=module.exports;${readFileSync(join(dirname(require.resolve('mediabunny')), 'mediabunny.min.cjs'), 'utf8')}`,
      })
      await encoder.evaluate(async (fps: number) => {
        const { Output, WebMOutputFormat, BufferTarget, CanvasSource, QUALITY_HIGH } = (
          window as unknown as { Mediabunny: typeof import('mediabunny') }
        ).Mediabunny
        const canvas = new OffscreenCanvas(1280, 720)
        const target = new BufferTarget()
        const output = new Output({ format: new WebMOutputFormat(), target })
        const source = new CanvasSource(canvas, { codec: 'vp9', bitrate: QUALITY_HIGH })
        output.addVideoTrack(source, { frameRate: fps })
        await output.start()
        Object.assign(window, { video: { canvas, target, output, source } })
      }, VIDEO_FPS)
      for (let index = 0; index < frames; index++) {
        await page.evaluate(
          `document.getAnimations().forEach((a) => { a.currentTime = ${(index / VIDEO_FPS) * 1000} })`,
        )
        const shot = (await stage.screenshot({ type: 'jpeg', quality: 90, animations: 'allow' })).toString('base64')
        await encoder.evaluate(
          async ({ shot, index, fps }: { shot: string; index: number; fps: number }) => {
            const { canvas, source } = (
              window as unknown as {
                video: { canvas: OffscreenCanvas; source: { add(t: number, d: number): Promise<void> } }
              }
            ).video
            const bitmap = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${shot}`)).blob())
            canvas.getContext('2d')!.drawImage(bitmap, 0, 0, 1280, 720)
            bitmap.close()
            await source.add(index / fps, 1 / fps)
          },
          { shot, index, fps: VIDEO_FPS },
        )
      }
      const encoded = await encoder.evaluate(async () => {
        const { output, target } = (
          window as unknown as {
            video: { output: { finalize(): Promise<void> }; target: { buffer: ArrayBuffer | null } }
          }
        ).video
        await output.finalize()
        const bytes = new Uint8Array(target.buffer!)
        let text = ''
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        return btoa(text)
      })
      return Buffer.from(encoded, 'base64')
    },
    5 * 60_000,
  )
}

/** One 1920 × 1080 PNG per slide, numbered in order, in one zip. */
function slideImages(document: InteractiveDocument): Promise<Buffer> {
  return withPage(document, { width: 1280, height: 720 }, 1.5, async (page) => {
    await page.addStyleTag({
      // The deck's own styles come later in the page, so these win on specificity.
      content:
        'html body{margin:0;padding:0}html body .ramu-deck{max-width:none;gap:0}html body .ramu-slide{border:0;border-radius:0}',
    })
    const slides = page.locator('[data-ramu-slide]')
    const count = await slides.count()
    const zip = new JSZip()
    const digits = String(count).length
    for (let index = 0; index < count; index++)
      zip.file(
        `slide-${String(index + 1).padStart(digits, '0')}.png`,
        await slides.nth(index).screenshot({ animations: 'disabled' }),
      )
    return zip.generateAsync({ type: 'nodebuffer' })
  })
}

/**
 * Files the host makes from a version: PDF for every kind, PowerPoint and slide images for a deck, Word for a doc. Each is kept
 * with the version it was made from, so asking again for the same version returns it at once.
 */
export class ArtifactExports {
  /** One export at a time: each starts its own browser. */
  private queue: Promise<unknown> = Promise.resolve()

  private readonly makers: Record<'pdf' | 'png' | 'webm', (document: InteractiveDocument) => Promise<Buffer>>

  constructor(
    private readonly db: Db,
    /** Tests replace the browser-backed makers they exercise. */
    makers: Partial<Record<'pdf' | 'png' | 'webm', (document: InteractiveDocument) => Promise<Buffer>>> = {},
  ) {
    this.makers = {
      pdf: printPdf,
      webm: motionVideo,
      png: (document) =>
        document.reference.kind === 'slides'
          ? slideImages(document)
          : document.reference.kind === 'design'
            ? frameImages(document)
            : pictureImage(document),
      ...makers,
    }
  }

  async make(document: InteractiveDocument, format: HostExportFormat): Promise<ExportedFile> {
    const kind = artifactKind(document.reference.kind)
    if (!hostExportFormats(kind).includes(format)) throw new Error(`This ${kind} does not export as ${format}.`)
    const { id, version } = document.reference
    const digest = createHash('sha256')
      .update(document.html)
      .update(JSON.stringify(document.files ?? null))
      .digest('hex')
    const slidesZip = format === 'png' && (kind === 'slides' || kind === 'design')
    const name = `${exportFileName(document.reference.title)}${slidesZip ? ` ${kind === 'design' ? 'frames' : 'slides'}.zip` : `.${format}`}`
    // A deck's slide images travel as one zip; a diagram's image is a single PNG.
    const mime = slidesZip ? 'application/zip' : MIME[format]
    const kept = this.db
      .prepare('SELECT data FROM interactive_exports WHERE id=? AND version=? AND format=? AND digest=?')
      .get(id, version, format, digest) as { data: Uint8Array } | undefined
    const file = (bytes: Uint8Array): ExportedFile => ({
      name,
      mimeType: mime,
      content: Buffer.from(bytes).toString('base64'),
      encoding: 'base64',
    })
    if (kept) return file(kept.data)
    const made = this.queue.then(() =>
      format === 'docx'
        ? writeDocx(docOf(document), document.reference.title)
        : format === 'pptx'
          ? writePptx(
              deckOf(document),
              document.reference.title,
              (document.files ?? []).filter((candidate) => candidate.encoding === 'base64'),
            )
          : this.makers[format](document),
    )
    this.queue = made.catch(() => {})
    const bytes = await made
    if (bytes.byteLength > EXPORT_MAX_BYTES)
      throw new Error('This export is larger than 10 MB. Use fewer or smaller images, or split the deck.')
    this.db
      .prepare(
        'INSERT OR REPLACE INTO interactive_exports(id,version,format,digest,name,mime,data,created_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(id, version, format, digest, name, mime, bytes, Date.now())
    this.db
      .prepare(
        'DELETE FROM interactive_exports WHERE rowid NOT IN (SELECT rowid FROM interactive_exports ORDER BY created_at DESC LIMIT ?)',
      )
      .run(KEPT_EXPORTS)
    return file(bytes)
  }
}
