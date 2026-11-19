import { useEffect, useMemo, useState } from 'react'
import { AppWindow, ChevronDown, ChevronRight } from 'lucide-react'
import type { InteractiveDocument, InteractiveReference, InteractiveState } from '@ramu/shared/interactive'
import { interactiveSourceDiff, type InteractiveRevision } from '@ramu/shared/interactiveRevisions'
import { Button } from '../components/desktop-button'
import { GHOST_TEXT_BUTTON_CLASS } from '../components/button-classes'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'
import { notifyError } from '../chat/Notifications'

/** Where the newest card of a document sits, so an older row can scroll to it. */
export const interactiveAnchor = (id: string) => `interactive-latest-${id}`

/** An older version, collapsed in its place in the transcript: what replaced it and how to get back to it. */
export function InteractiveVersionRow({
  reference,
  revision,
}: {
  reference: InteractiveReference
  revision: InteractiveRevision
}) {
  useLanguage()
  const { invoke } = useHost()
  const [open, setOpen] = useState(false)
  const [document, setDocument] = useState<InteractiveDocument | null>(null)
  const [restoring, setRestoring] = useState(false)
  const successor = revision.versions.filter((entry) => entry.version > reference.version).at(-1)
  useEffect(() => {
    if (!open || document) return
    let cancelled = false
    void invoke('interactive.get', reference.sessionId, reference.id, reference.version)
      .then((value) => !cancelled && setDocument(value))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, document, invoke, reference])
  const latest = revision.latest
  const restore = async () => {
    setRestoring(true)
    try {
      await invoke('interactive.restore', reference.sessionId, reference.id, reference.version)
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error), t('Could not restore this version'))
    } finally {
      setRestoring(false)
    }
  }
  return (
    <section className="my-2 rounded-lg bg-fill/60" aria-label={reference.title}>
      <div className="flex min-h-9 items-center gap-1.5 py-1 pr-1.5 pl-2">
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6 text-muted-foreground"
          aria-expanded={open}
          aria-label={open ? t('Hide this version') : t('Show this version')}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </Button>
        <AppWindow size={14} className="flex-none text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate text-body font-medium">{reference.title}</span>
        <span className="flex-none text-caption text-muted-foreground">
          {t('v{version} · replaced by v{latest}', { version: reference.version, latest: latest.version })}
        </span>
        {successor?.changes && (
          <span className="min-w-0 truncate text-caption text-muted-foreground" title={successor.changes}>
            · {successor.changes}
          </span>
        )}
        <Button
          variant="ghost"
          className={`${GHOST_TEXT_BUTTON_CLASS} ml-auto flex-none`}
          onClick={() =>
            window.document
              .getElementById(interactiveAnchor(reference.id))
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        >
          {t('Go to latest')}
        </Button>
      </div>
      {open && (
        <div className="border-t border-border p-3">
          <p className="mt-0 mb-2 text-caption text-muted-foreground">
            {t('Read-only. Restore publishes this version again as the newest one.')}
          </p>
          {document?.preview ? (
            <img
              src={document.preview}
              alt={t('Preview of {title}', { title: reference.title })}
              className="max-h-[480px] max-w-full rounded-md object-contain"
            />
          ) : (
            <p className="m-0 text-caption text-muted-foreground">{t('Loading…')}</p>
          )}
          <div className="mt-2">
            <Button disabled={restoring} onClick={() => void restore()}>
              {t('Restore v{version}', { version: reference.version })}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

/** The previous and new versions side by side at phone or desktop width, with the source diff one click away. */
export function InteractiveCompare({
  previous,
  current,
  document,
}: {
  previous: InteractiveReference
  current: InteractiveReference
  document: InteractiveDocument | null
}) {
  useLanguage()
  const { invoke } = useHost()
  const [width, setWidth] = useState<'phone' | 'desktop'>('phone')
  const [before, setBefore] = useState<InteractiveDocument | null>(null)
  const [media, setMedia] = useState<Record<number, { wide: string | null }>>({})
  const [source, setSource] = useState(false)
  useEffect(() => {
    let cancelled = false
    void invoke('interactive.get', previous.sessionId, previous.id, previous.version)
      .then((value) => !cancelled && setBefore(value))
      .catch(() => {})
    for (const reference of [previous, current])
      void invoke('interactive.media', reference.sessionId, reference.id, reference.version)
        .then((value) => !cancelled && setMedia((all) => ({ ...all, [reference.version]: value })))
        .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [invoke, previous, current])
  const picture = (reference: InteractiveReference, doc: InteractiveDocument | null) =>
    width === 'desktop' ? (media[reference.version]?.wide ?? null) : (doc?.preview ?? null)
  const diff = useMemo(
    () => (source && before && document ? interactiveSourceDiff(sourceOf(before), sourceOf(document)) : []),
    [source, before, document],
  )
  return (
    <div className="border-b border-border p-3">
      <div className="mb-2 flex items-center gap-1">
        {(['phone', 'desktop'] as const).map((value) => (
          <Button
            key={value}
            variant="ghost"
            aria-pressed={width === value}
            className={`${GHOST_TEXT_BUTTON_CLASS} aria-pressed:bg-raised aria-pressed:text-foreground`}
            onClick={() => setWidth(value)}
          >
            {value === 'phone' ? t('Phone') : t('Desktop')}
          </Button>
        ))}
        <Button
          variant="ghost"
          aria-pressed={source}
          className={`${GHOST_TEXT_BUTTON_CLASS} ml-auto aria-pressed:bg-raised aria-pressed:text-foreground`}
          onClick={() => setSource((value) => !value)}
        >
          {t('Source changes')}
        </Button>
      </div>
      {source ? (
        <pre className="m-0 max-h-[420px] overflow-auto rounded-md bg-(--code-bg) p-2 font-mono text-caption">
          {diff.length === 0 ? (
            <span className="text-muted-foreground">{before ? t('No source changes.') : t('Loading…')}</span>
          ) : (
            diff.map((line, index) => (
              <div
                key={index}
                className={
                  line.kind === '+' ? 'text-(--ok)' : line.kind === '-' ? 'text-(--bad)' : 'text-muted-foreground'
                }
              >
                {line.kind} {line.text}
              </div>
            ))
          )}
        </pre>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {[
            { reference: previous, doc: before },
            { reference: current, doc: document },
          ].map(({ reference, doc }) => {
            const src = picture(reference, doc)
            return (
              <figure key={reference.version} className="m-0 min-w-0">
                <figcaption className="mb-1 text-caption text-muted-foreground">v{reference.version}</figcaption>
                {src ? (
                  <img
                    src={src}
                    alt={t('Preview of {title}', { title: `${reference.title} v${reference.version}` })}
                    className="max-h-[420px] max-w-full rounded-md object-contain"
                  />
                ) : (
                  <p className="m-0 text-caption text-muted-foreground">{t('No screenshot for this width.')}</p>
                )}
              </figure>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Project sources read as one text, file by file, so a diff shows what the agent edited rather than the bundle. */
function sourceOf(document: InteractiveDocument): string {
  if (!document.files?.length) return document.html
  return document.files
    .filter((file) => file.encoding !== 'base64')
    .map((file) => `// ${file.path}\n${file.content}`)
    .join('\n')
}

/** The values of a previous version that could not move to this one, shown so they can be entered again. */
export function InteractiveCarriedValues({ state }: { state: InteractiveState }) {
  useLanguage()
  const controls = state.controls.filter((control) => control.value || control.checked)
  if (!controls.length) return null
  return (
    <ul className="mt-1 mb-0 list-none p-0 text-caption">
      {controls.slice(0, 20).map((control) => (
        <li key={control.key} className="truncate">
          <span className="text-muted-foreground">{control.label ?? control.key}:</span>{' '}
          {control.value || (control.checked ? t('On') : '')}
        </li>
      ))}
    </ul>
  )
}
