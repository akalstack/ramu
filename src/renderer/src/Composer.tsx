import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ArrowUp, CornerDownRight, FileText, ListEnd, Paperclip, Play, Square, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import type { Attachment, FileContext } from '../../shared/types'
import { invoke } from './ipc'
import { ComposerSuggestions, FILE_DRAG_TYPE, MAX_PINNED_FILES, useComposerSuggestions } from './ComposerSuggestions'
import { Attachments } from './Attachments'

const CHIPS_SHOWN = 4
// Keep long documents out of the prompt box while leaving ordinary pastes inline.
const PASTE_ATTACHMENT_CHARACTERS = 4000
const PASTE_ATTACHMENT_LINES = 40

/** Auto-growing prompt box. Enter sends, Shift+Enter adds a line. */
export function Composer({
  value,
  scopeId,
  onChange,
  onSubmit,
  onAlternateSubmit,
  alternateLabel,
  alternateDisabled,
  placeholder,
  submitLabel,
  disabled,
  autoFocus,
  footer,
  controls,
  actions,
  attachments = [],
  onAttachmentsChange,
  stop,
  resume,
  chips,
  allowEmpty = false,
}: {
  value: string
  scopeId?: string
  onChange: (v: string) => void
  onSubmit: (context: FileContext[]) => void
  onAlternateSubmit?: (context: FileContext[]) => void
  alternateLabel?: string
  alternateDisabled?: boolean
  placeholder: string
  submitLabel: string
  disabled?: boolean
  autoFocus?: boolean
  footer?: ReactNode
  controls?: ReactNode
  actions?: ReactNode
  attachments?: Attachment[]
  onAttachmentsChange?: (files: Attachment[]) => void
  /** While a turn is running and the box is empty, the send button becomes a stop button. */
  stop?: { active: boolean; onStop: () => void }
  /** After a stopped turn, an empty box offers a play button to carry on. */
  resume?: { active: boolean; onResume: () => void }
  /** Shown above the text, e.g. review comments riding along with this message. */
  chips?: ReactNode
  /** Lets the message go out with no text, because the chips carry the content. */
  allowEmpty?: boolean
}) {
  const [caret, setCaret] = useState(value.length)
  const suggestions = useComposerSuggestions(value, caret, scopeId)
  const [uploading, setUploading] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  // Notices about files that did not fit go away on their own.
  useEffect(() => {
    if (!attachmentError) return
    const timer = window.setTimeout(() => setAttachmentError(null), 5000)
    return () => window.clearTimeout(timer)
  }, [attachmentError])
  const [dragging, setDragging] = useState(false)
  const currentFiles = useRef(attachments)
  currentFiles.current = attachments
  const uploadQueue = useRef(Promise.resolve())
  const pendingUploads = useRef(0)
  const pastedCount = useRef(0)
  const importFiles = (files?: File[]): Promise<boolean> => {
    if (!onAttachmentsChange) return Promise.resolve(false)
    pendingUploads.current++
    setUploading(true)
    const operation = uploadQueue.current.then(async () => {
    setAttachmentError(null)
    try {
      if (files && files.length + currentFiles.current.length > 10) throw new Error('Attach up to 10 files per message.')
      const selected = files ? await Promise.all(files.map(async (file) => {
        if (!file.size || file.size > 10 * 1024 * 1024) throw new Error(`${file.name}: files must be nonempty and no larger than 10 MB.`)
        const encoded = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = () => reject(new Error(`Could not read ${file.name}`)); reader.readAsDataURL(file) })
        return invoke('attachments.add', file.name, encoded)
      })) : await invoke('attachments.pick')
      if (selected.length + currentFiles.current.length > 10) throw new Error('Attach up to 10 files per message.')
      currentFiles.current = [...currentFiles.current, ...selected]
      onAttachmentsChange(currentFiles.current)
      return true
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : String(error))
      return false
    } finally { if (--pendingUploads.current === 0) setUploading(false) }
    })
    uploadQueue.current = operation.then(() => {})
    return operation
  }
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
    // Only scroll once the box has hit its cap; otherwise a sliver of scrollbar shows on an empty prompt.
    el.style.overflowY = el.scrollHeight > 240 ? 'auto' : 'hidden'
  }, [value])

  const choose = (index: number) => {
    const choice = suggestions.choices[index]; if (!choice) return
    const next = suggestions.choose(choice); onChange(next.value); setCaret(next.caret)
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(next.caret, next.caret) })
  }
  const submit = () => { onSubmit(suggestions.hydrate()); suggestions.clearPinned(); setAttachmentError(null) }
  const alternate = () => { onAlternateSubmit?.(suggestions.hydrate()); suggestions.clearPinned() }
  const hasPinned = suggestions.pinned.length > 0
  const canAlternate = !alternateDisabled && !uploading && (allowEmpty || hasPinned || value.trim().length > 0 || attachments.length > 0)
  const showStop = !allowEmpty && !hasPinned && !!stop?.active && !value.trim() && attachments.length === 0
  const showResume = !allowEmpty && !hasPinned && !showStop && !!resume?.active && !value.trim() && attachments.length === 0
  const rootRef = useRef<HTMLDivElement>(null)
  const [showAllChips, setShowAllChips] = useState(false)
  // A file dragged from the Explorer becomes an @mention, so it rides along as context; files from the desktop become attachments.
  const handleDrop = (dragged: string, files: File[]) => {
    if (dragged) {
      void (async () => {
        try {
          const item = JSON.parse(dragged) as { repoId: string; path: string; kind?: 'file' | 'dir'; items?: { path: string; kind?: 'file' | 'dir' }[] }
          if (!item.repoId) return
          const list = item.items?.length ? item.items : typeof item.path === 'string' ? [{ path: item.path, kind: item.kind }] : []
          const picked: { repoId: string; path: string }[] = []
          let all: { repoId: string; path: string }[] | null = null
          for (const entry of list) {
            if (entry.kind !== 'dir') { picked.push({ repoId: item.repoId, path: entry.path }); continue }
            // A folder adds the files inside it.
            all ??= await invoke('files.all', suggestions.scope ?? '')
            const prefix = entry.path ? `${entry.path}/` : ''
            picked.push(...all.filter((file) => file.repoId === item.repoId && file.path.startsWith(prefix)))
          }
          if (!picked.length) { setAttachmentError('Nothing to add: those folders have no files.'); return }
          const dropped = suggestions.pinMany(picked)
          setAttachmentError(dropped ? `Only ${MAX_PINNED_FILES} files can be added as context per message. ${dropped} ${dropped === 1 ? 'was' : 'were'} left out.` : null)
        } catch { /* Not one of ours. */ }
        requestAnimationFrame(() => ref.current?.focus())
      })()
      return
    }
    if (onAttachmentsChange && files.length) void importFiles(files)
  }
  // The whole chat accepts drops (see AgentView); it hands them to the composer in the same pane.
  const latestDrop = useRef(handleDrop); latestDrop.current = handleDrop
  useEffect(() => {
    const onChatDrop = (event: Event) => {
      const { root, dragged, files } = (event as CustomEvent<{ root: Element; dragged: string; files: File[] }>).detail
      if (rootRef.current?.closest('.agent-view') === root) latestDrop.current(dragged, files)
    }
    window.addEventListener('ramu:chat-drop', onChatDrop)
    return () => window.removeEventListener('ramu:chat-drop', onChatDrop)
  }, [])
  const canSend = !disabled && !uploading && (value.trim().length > 0 || attachments.length > 0)
  return (<>
    <div ref={rootRef} className={`composer${dragging ? ' dragging' : ''}`}
      onDragOver={(event) => { if (event.dataTransfer.types.includes(FILE_DRAG_TYPE) || onAttachmentsChange && event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true) } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
      onDrop={(event) => {
        const dragged = event.dataTransfer.getData(FILE_DRAG_TYPE), files = [...event.dataTransfer.files]
        if (dragged || onAttachmentsChange && files.length) { event.preventDefault(); setDragging(false); handleDrop(dragged, files) }
      }}>
      {suggestions.visible && <ComposerSuggestions suggestions={suggestions} onChoose={choose} />}
      {(chips || hasPinned) && <div className="composer-chips">{chips}{(showAllChips ? suggestions.pinned : suggestions.pinned.slice(0, CHIPS_SHOWN)).map((file) => <span key={`${file.repoId}:${file.path}`} className="attachment-chip comments-chip" title={`${suggestions.repoName(file.repoId)}/${file.path}`}>
        <span className="attachment-open file"><FileText size={15} /><span className="attachment-name">{file.path.slice(file.path.lastIndexOf('/') + 1)}</span></span>
        <Button type="button" className="comments-chip-x" aria-label={`Remove ${file.path}`} onClick={() => { suggestions.unpin(file); setAttachmentError(null) }}><X size={13} /></Button>
      </span>)}
        {suggestions.pinned.length > CHIPS_SHOWN && <Button type="button" className="chip-more" onClick={() => setShowAllChips((value) => !value)}>{showAllChips ? 'Show less' : `+${suggestions.pinned.length - CHIPS_SHOWN} more`}</Button>}
        {suggestions.pinned.length + attachments.length > 1 && <Button type="button" className="chip-more clear" onClick={() => { suggestions.clearPinned(); setAttachmentError(null); setShowAllChips(false); if (attachments.length) onAttachmentsChange?.([]) }}>Clear all</Button>}
      </div>}
      {attachments.length > 0 && <Attachments files={attachments} onRemove={(id) => onAttachmentsChange?.(attachments.filter((file) => file.id !== id))} />}
      {attachmentError && <div className="error small" role="alert">{attachmentError}</div>}
      <Textarea
        ref={ref}
        rows={1}
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onPaste={(event) => {
          if (!onAttachmentsChange) return
          const files = [...event.clipboardData.files]
          if (files.length) { event.preventDefault(); void importFiles(files); return }
          const text = event.clipboardData.getData('text/plain')
          if (text.length < PASTE_ATTACHMENT_CHARACTERS && text.split(/\r\n|\r|\n/).length < PASTE_ATTACHMENT_LINES) return
          event.preventDefault()
          const number = ++pastedCount.current
          const name = number === 1 ? 'Pasted text.txt' : `Pasted text ${number}.txt`
          void importFiles([new File([text], name, { type: 'text/plain;charset=utf-8' })]).then((attached) => {
            if (attached || !ref.current) return
            // Preserve the paste if storage fails or the attachment limit is reached.
            const input = ref.current
            input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end')
            onChange(input.value)
            const position = input.selectionStart
            setCaret(position)
            requestAnimationFrame(() => { input.focus(); input.setSelectionRange(position, position) })
          })
        }}
        aria-autocomplete="list"
        aria-controls={suggestions.visible ? suggestions.listId : undefined}
        aria-expanded={suggestions.visible}
        aria-activedescendant={suggestions.visible && suggestions.choices.length ? `${suggestions.listId}-${suggestions.selected}` : undefined}
        onClick={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
        onChange={(e) => { onChange(e.target.value); setCaret(e.target.selectionStart) }}
        onKeyDown={(e) => {
          if (suggestions.visible && !e.nativeEvent.isComposing) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); suggestions.move(e.key === 'ArrowDown' ? 1 : -1); return }
            if (e.key === 'Escape') { e.preventDefault(); suggestions.dismiss(); return }
            if ((e.key === 'Enter' && !e.shiftKey || e.key === 'Tab') && suggestions.choices.length) { e.preventDefault(); choose(suggestions.selected); return }
          }
          if (e.key === 'Enter'  && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if ((e.metaKey || e.ctrlKey) && onAlternateSubmit) { if (canAlternate) alternate() }
            else if (canSend) submit()
          }
        }}
      />
      <div className="composer-bar">
        {onAttachmentsChange && <Button className="ghost icon small-icon" aria-label="Attach files" title="Attach files" disabled={uploading || attachments.length >= 10} onClick={() => void importFiles()}><Paperclip size={15} /></Button>}
        {controls ? <div className="composer-controls">{controls}</div> : <span className="grow" />}
        {actions}
        {onAlternateSubmit && <Button className="ghost icon small-icon" disabled={!canAlternate} aria-label={alternateLabel} title={`${alternateLabel} (⌘Enter / Ctrl+Enter)`} onClick={alternate}>{alternateLabel === 'Queue' ? <ListEnd size={15} /> : <CornerDownRight size={15} />}</Button>}
        <Button className={showStop ? 'send stop' : showResume ? 'send resume' : 'send'} aria-label={showStop ? 'Stop' : showResume ? 'Resume' : submitLabel} title={showStop ? 'Stop this turn' : showResume ? 'Resume where it stopped' : `${submitLabel} (Enter)`} disabled={showStop || showResume ? false : !canSend} onClick={showStop ? stop!.onStop : showResume ? resume!.onResume : submit}>
          {showStop ? <Square size={12} fill="currentColor" strokeWidth={0} /> : showResume ? <Play size={13} fill="currentColor" strokeWidth={0} /> : <ArrowUp size={16} strokeWidth={2.25} />}
        </Button>
      </div>
    </div>
    {footer && <div className="composer-footer">{footer}</div>}
  </>)
}
