// Mermaid diagrams drawn by Pele: each diagram type loads on first use, colors come from the theme's CSS variables so a
// diagram follows light and dark without drawing again, and a diagram that is still being written keeps its last good
// drawing instead of flashing an error on every token.
import DOMPurify from 'dompurify'
import type { MountOptions, Mounted } from 'pele/lazy'
import { useEffect, useRef, useState } from 'react'
import { Check, Code2, Copy, Maximize2, Workflow } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@/components/ui/code-block'
import { copyText } from '../ipc'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { notifyError } from './Notifications'

type Pele = typeof import('pele/lazy')

const MAX_SOURCE = 50_000
/** How long the source must stay unchanged before a redraw, so a streaming reply draws a few times, not per token. */
const SETTLE_MS = 250

let peleLoad: Promise<Pele> | null = null
function loadPele(): Promise<Pele> {
  peleLoad ??= import('pele/lazy').catch((error: unknown) => {
    peleLoad = null
    throw error
  })
  return peleLoad
}

let purifier: ReturnType<typeof DOMPurify> | null = null
// Diagrams come from agents and pull request text. Pele escapes labels and links and images are off; this also drops
// anything that could navigate, run script or fetch, should a diagram type ever emit it.
function sanitize(svg: string): Node {
  purifier ??= DOMPurify(window)
  return purifier.sanitize(svg, {
    FORBID_ATTR: ['href', 'xlink:href', 'src', 'srcset'],
    FORBID_TAGS: ['a', 'image', 'foreignObject', 'style', 'script'],
    USE_PROFILES: { svg: true, svgFilters: true },
    RETURN_DOM_FRAGMENT: true,
  })
}

type DiagramState = { drawn: boolean; error: string | null; unavailable: boolean }

/** Draws `source` into the returned element and redraws it in place as the source changes. */
function useDiagram(source: string, zoom: MountOptions['zoom'], attempt: number) {
  const element = useRef<HTMLDivElement>(null)
  const mounted = useRef<Mounted | null>(null)
  const [state, setState] = useState<DiagramState>({ drawn: false, error: null, unavailable: false })
  useEffect(
    () => () => {
      mounted.current?.destroy()
      mounted.current = null
    },
    [],
  )
  useEffect(() => {
    const text = source.trim()
    if (!text) return
    let cancelled = false
    const draw = async () => {
      if (text.length > MAX_SOURCE) {
        setState((current) => ({ ...current, error: t('Diagram too large') }))
        return
      }
      let pele: Pele
      try {
        pele = await loadPele()
        let type = null
        try {
          type = pele.detectType(text)
        } catch {
          // An unknown first line is reported by the drawing below.
        }
        await pele.load(type)
      } catch {
        if (!cancelled) setState((current) => ({ ...current, unavailable: true }))
        return
      }
      if (cancelled || !element.current) return
      const options: MountOptions = {
        links: false,
        images: false,
        // Keep the author's direction; a wide diagram scales down to fit instead of turning vertical.
        autoDirection: false,
        zoom,
        sanitize,
        onRender: () => setState({ drawn: true, error: null, unavailable: false }),
        onError: (error) =>
          setState((current) => ({
            ...current,
            unavailable: false,
            error: error instanceof Error ? error.message : String(error),
          })),
      }
      if (mounted.current) mounted.current.update(text, options)
      else mounted.current = pele.mount(element.current, text, options)
    }
    const timer = window.setTimeout(() => void draw(), mounted.current ? SETTLE_MS : 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [source, zoom, attempt])
  return { element, state }
}

function useCopySource(source: string) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])
  const copy = async () => {
    try {
      await copyText(source)
      setCopied(true)
    } catch (error) {
      notifyError(errorText(error), t('Copy diagram source'))
    }
  }
  return { copied, copy }
}

const ICON_BUTTON = 'text-muted-foreground hover:bg-transparent hover:text-foreground'

/** A fenced `mermaid` block: the drawn diagram with its source, a larger view and a copy one click away. */
export function MermaidBlock({ source }: { source: string }) {
  useLanguage()
  const [showSource, setShowSource] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const { element, state } = useDiagram(source, false, attempt)
  const { copied, copy } = useCopySource(source)
  const failed = state.unavailable || (!state.drawn && state.error !== null)
  const sourceShown = showSource || failed
  return (
    <CodeBlock className="mt-1 mb-3 border-transparent bg-(--code-bg) dark:bg-(--code-bg)">
      <CodeBlockHeader className="border-b border-line px-3.5 py-1.5 pt-1.5">
        <CodeBlockTitle className="font-normal text-caption text-muted-foreground">.mermaid</CodeBlockTitle>
        <CodeBlockActions>
          {!failed && (
            <Button
              variant="ghost"
              size="icon-xs"
              className={ICON_BUTTON}
              aria-label={showSource ? t('Show diagram') : t('Show code')}
              title={showSource ? t('Show diagram') : t('Show code')}
              onClick={() => setShowSource((value) => !value)}
            >
              {showSource ? <Workflow size={14} /> : <Code2 size={14} />}
            </Button>
          )}
          {state.drawn && (
            <Button
              variant="ghost"
              size="icon-xs"
              className={ICON_BUTTON}
              aria-label={t('Expand diagram')}
              title={t('Expand diagram')}
              onClick={() => setExpanded(true)}
            >
              <Maximize2 size={14} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON}
            aria-label={copied ? t('Copied') : t('Copy diagram source')}
            title={copied ? t('Copied') : t('Copy diagram source')}
            onClick={() => void copy()}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </Button>
        </CodeBlockActions>
      </CodeBlockHeader>
      {(state.unavailable || state.error) && (
        <div className="flex items-center gap-2 px-3.5 pt-2.5 text-caption text-bad">
          <span className="min-w-0 flex-1">
            {state.unavailable
              ? t('The diagram renderer did not load.')
              : t('This diagram could not be drawn: {0}', { '0': state.error ?? '' })}
          </span>
          {state.unavailable && (
            <Button variant="ghost" size="sm" onClick={() => setAttempt((value) => value + 1)}>
              {t('Try again')}
            </Button>
          )}
        </div>
      )}
      <div
        ref={element}
        role="img"
        aria-label={t('Mermaid diagram')}
        hidden={sourceShown}
        className="ramu-diagram flex justify-center overflow-x-auto px-3.5 py-3 [&_.pele-error]:hidden"
      />
      {!state.drawn && !sourceShown && !state.error && (
        <p className="px-3.5 pb-3 text-caption text-muted-foreground">{t('Rendering diagram…')}</p>
      )}
      {sourceShown && (
        <CodeBlockContent className="px-3.5 py-3 text-[length:0.88em] leading-[1.6] text-(--text-body)">
          {source}
        </CodeBlockContent>
      )}
      {expanded && <MermaidDialog source={source} onClose={() => setExpanded(false)} />}
    </CodeBlock>
  )
}

/** The diagram at full size: pinch, scroll or the buttons zoom, dragging pans. */
function MermaidDialog({ source, onClose }: { source: string; onClose: () => void }) {
  const [zoom] = useState<MountOptions['zoom']>(() => ({
    always: true,
    controls: true,
    labels: { zoomIn: t('Zoom in'), zoomOut: t('Zoom out'), reset: t('Reset zoom') },
  }))
  const { element } = useDiagram(source, zoom, 0)
  const { copied, copy } = useCopySource(source)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[calc(100vh-48px)] w-[min(1200px,calc(100vw-48px))] flex-col gap-3 bg-(--code-bg) p-4 sm:max-w-none"
      >
        <div className="flex items-center gap-2 pr-8">
          <DialogTitle className="flex-1">{t('Mermaid diagram')}</DialogTitle>
          <Button variant="ghost" size="sm" onClick={() => void copy()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? t('Copied') : t('Copy diagram source')}
          </Button>
        </div>
        <div
          ref={element}
          role="img"
          aria-label={t('Mermaid diagram')}
          className="ramu-diagram relative min-h-0 flex-1 overflow-hidden rounded-(--radius-s) [&_.pele-error]:text-bad"
        />
      </DialogContent>
    </Dialog>
  )
}
