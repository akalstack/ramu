import { flushSync } from 'react-dom'
import { Spinner } from '@/components/ui/spinner'
import { ComposerInput, type ComposerInputHandle } from './ComposerInput'
import { errorText } from '../lib/errors'
import { t, useLanguage } from '../i18n'
import { Button } from '@/components/ui/button'
import { ArrowUp, CornerDownRight, FileText, ListEnd, Paperclip, Play, Square, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { Attachment, FileContext } from '@ramu/shared/types'
import { invoke as ownInvoke, ramu } from '../ipc'
import {
  ComposerSuggestions,
  FILE_DRAG_TYPE,
  MAX_PINNED_FILES,
  useComposerSuggestions,
  type ComposerTeammate,
} from './ComposerSuggestions'
import { Attachments } from './Attachments'
import { registerWorkspaceCheckpoint } from '../workspace/workspaceCheckpoint'
import { useHost } from '../workspace/HostProvider'
import { VIEW_ONLY_NOTICE } from './viewerAccess'
import { useViewOnly } from './useViewOnly'
import { DictationStatus, MicButton } from '../voice/DictationControls'
import { useDictation, useMicControl, useVoiceCapability, useVoiceSettings } from '../voice/useDictation'
import { dictationBusy } from '@ramu/shared/voice/dictation'

const CHIPS_SHOWN = 4
// Keep long documents out of the prompt box while leaving ordinary pastes inline.
const PASTE_ATTACHMENT_CHARACTERS = 4000
const MAX_MESSAGE_CHARACTERS = 1_000_000 // what the background service accepts for one message
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
  onArrowUpEmpty,
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
  chat = false,
  teammate,
}: {
  value: string
  scopeId?: string
  onChange: (v: string) => void
  onSubmit: (context: FileContext[]) => void | Promise<void>
  onAlternateSubmit?: (context: FileContext[]) => void | Promise<void>
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
  /**
   * After a stopped turn, an empty box offers a play button to carry on. At a usage limit it is "Try again" instead,
   * through `label` and `title` (English keys).
   */
  resume?: { active: boolean; onResume: () => void; label?: string; title?: string }
  /** Shown above the text, e.g. review comments riding along with this message. */
  chips?: ReactNode
  /** Lets the message go out with no text, because the chips carry the content. */
  allowEmpty?: boolean
  /** ↑ in an empty message box, e.g. to edit the last message you sent. */
  onArrowUpEmpty?: () => void
  /** A chat's own composer, which offers chat-only commands such as /aside. */
  chat?: boolean
  /** The thread's teammate, or how to add one, for `@` and `/teammate`. */
  teammate?: ComposerTeammate
}) {
  useLanguage()
  const [caret, setCaret] = useState(value.length)
  const suggestions = useComposerSuggestions(value, caret, scopeId, chat, teammate)
  const [submitting, setSubmitting] = useState(false)
  const submissionPending = useRef(false)
  const submissionOrigin = useRef<{ host: string; scope: string | null } | null>(null)
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
  const uploadState = useRef(uploading)
  uploadState.current = uploading
  const pinnedCount = useRef(suggestions.pinned.length)
  pinnedCount.current = suggestions.pinned.length
  // Attachments upload to the host the composer sends to; the native picker runs on this window's own host.
  const { id: checkpointHost, isLocal, invoke } = useHost()
  const viewOnly = useViewOnly()
  const scopeKey = JSON.stringify([checkpointHost, suggestions.scope])
  // Dictation: a take belongs to this host's draft and the revision it started from. An edit, restored draft or
  // another thread never receives its text; the draft is frozen while a take runs. Choices are device-local.
  const [voiceSettings] = useVoiceSettings()
  const voiceCapability = useVoiceCapability(voiceSettings)
  const mic = useMicControl(voiceSettings, voiceCapability)
  const revision = useRef(0)
  const latestValue = useRef(value)
  latestValue.current = value
  useEffect(() => {
    revision.current += 1
  }, [value])
  const dictationKey = JSON.stringify([checkpointHost, suggestions.scope ?? scopeId ?? ''])
  const takeSelection = useRef({ start: 0, end: 0 })
  const dictation = useDictation({
    draftKey: dictationKey,
    settings: voiceSettings,
    getDraft: () => ({ draftKey: dictationKey, revision: revision.current, text: latestValue.current }),
    onInsert: ({ text: next, caret: at }) => {
      const input = ref.current
      const current = latestValue.current
      const start = Math.min(takeSelection.current.start, current.length)
      const end = Math.max(start, Math.min(takeSelection.current.end, current.length))
      const inserted = next.slice(start, next.length - (current.length - end))
      // One edit through the editor, so undo removes the whole transcript.
      if (input) input.setRangeText(inserted, start, end)
      else onChange(next)
      setCaret(at)
      requestAnimationFrame(() => {
        ref.current?.focus()
        ref.current?.setSelectionRange(at, at)
      })
    },
  })
  const dictating = dictationBusy(dictation.snapshot.state)
  const recording = dictation.snapshot.state.phase === 'recording' || dictation.snapshot.state.phase === 'limit'
  const startDictation = () => {
    if (mic.kind === 'blocked') {
      if (mic.reason === 'permission-denied') void window.ramu.voice?.openSettings()
      return
    }
    if (mic.kind === 'hidden') return
    const input = ref.current
    const start = input?.selectionStart ?? latestValue.current.length
    takeSelection.current = { start, end: input?.selectionEnd ?? start }
    dictation.session.start({
      draftKey: dictationKey,
      revision: revision.current,
      selection: { ...takeSelection.current },
    })
  }
  const toggleDictation = () => {
    const phase = dictation.snapshot.state.phase
    if (recording) dictation.session.stop()
    else if (phase === 'idle' || phase === 'failed' || phase === 'review') startDictation()
  }
  const toggleRef = useRef(toggleDictation)
  toggleRef.current = toggleDictation
  const micVisible = mic.kind !== 'hidden' && !viewOnly
  // The "Dictate message" command (and its shortcut) reaches the composer the person is working in.
  useEffect(() => {
    const onCommand = () => {
      const root = rootRef.current
      if (!micVisible || !root || !root.checkVisibility()) return
      const focused = root.contains(document.activeElement)
      if (!focused && [...document.querySelectorAll('.composer')].filter((el) => el.checkVisibility()).length > 1)
        return
      toggleRef.current()
    }
    window.addEventListener('ramu:dictate', onCommand)
    return () => window.removeEventListener('ramu:dictate', onCommand)
  }, [micVisible])
  // Escape discards a take that is running, wherever focus is.
  useEffect(() => {
    if (!dictating) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      dictation.session.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dictating, dictation.session])
  const [submissionFailure, setSubmissionFailure] = useState<{ scope: string; message: string } | null>(null)
  const currentScope = useRef({ host: checkpointHost, scope: suggestions.scope })
  currentScope.current = { host: checkpointHost, scope: suggestions.scope }
  const currentPinned = useRef(suggestions.pinned)
  currentPinned.current = suggestions.pinned
  useEffect(
    () =>
      registerWorkspaceCheckpoint(
        async () =>
          !submissionPending.current &&
          !uploadState.current &&
          !pendingUploads.current &&
          !currentFiles.current.length &&
          !pinnedCount.current,
        checkpointHost,
      ),
    [checkpointHost],
  )
  const uploadQueue = useRef(Promise.resolve())
  const pendingUploads = useRef(0)
  const pastedCount = useRef(0)
  const importFiles = (files?: File[], dropped = false): Promise<boolean> => {
    if (viewOnly || !onAttachmentsChange) return Promise.resolve(false)
    if (!files && !isLocal)
      return new Promise<boolean>((resolve) => {
        const picker = document.createElement('input')
        picker.type = 'file'
        picker.multiple = true
        picker.onchange = () => {
          void importFiles(Array.from(picker.files ?? [])).then(resolve)
        }
        picker.oncancel = () => resolve(false)
        picker.click()
      })
    pendingUploads.current++
    setUploading(true)
    const operation = uploadQueue.current.then(async () => {
      setAttachmentError(null)
      try {
        if (files && dropped) {
          const paths = files.map((file) => ramu.pathForFile(file))
          const info = await ramu.invoke('files.dropInfo', paths.filter(Boolean))
          const folders = new Set(info.filter((entry) => entry.kind === 'dir').map((entry) => entry.path))
          const input = ref.current
          if (folders.size && input) {
            const text = [...folders].map((path) => JSON.stringify(path)).join('\n')
            const start = input.selectionStart,
              end = input.selectionEnd
            const insertion = `${start && !/\s$/.test(input.value.slice(0, start)) ? '\n' : ''}${text}\n`
            input.setRangeText(insertion, start, end, 'end')
            setCaret(start + insertion.length)
            input.focus()
          }
          files = files.filter((_, index) => !folders.has(paths[index]!))
        }
        if (files && files.length + currentFiles.current.length > 10)
          throw new Error(t('Attach up to 10 files per message.'))
        const selected = files
          ? await Promise.all(
              files.map(async (file) => {
                if (!file.size || file.size > 10 * 1024 * 1024)
                  throw new Error(`${file.name}: files must be nonempty and no larger than 10 MB.`)
                const encoded = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader()
                  reader.onload = () => resolve(String(reader.result).split(',')[1]!)
                  reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
                  reader.readAsDataURL(file)
                })
                return invoke('attachments.add', file.name, encoded)
              }),
            )
          : await ownInvoke('attachments.pick')
        if (selected.length + currentFiles.current.length > 10) throw new Error(t('Attach up to 10 files per message.'))
        currentFiles.current = [...currentFiles.current, ...selected]
        onAttachmentsChange(currentFiles.current)
        return true
      } catch (error) {
        setAttachmentError(error instanceof Error ? error.message : errorText(error))
        return false
      } finally {
        if (--pendingUploads.current === 0) setUploading(false)
      }
    })
    uploadQueue.current = operation.then(() => {})
    return operation
  }
  const ref = useRef<ComposerInputHandle>(null)

  const choose = (index: number) => {
    const choice = suggestions.choices[index]
    if (!choice) return
    const next = suggestions.choose(choice)
    onChange(next.value)
    setCaret(next.caret)
    requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.setSelectionRange(next.caret, next.caret)
    })
  }
  const send = async (handler: (context: FileContext[]) => void | Promise<void>) => {
    // Lock immediately: repeated Enter presses can arrive before React renders the disabled button.
    if (viewOnly || submissionPending.current) return
    submissionPending.current = true
    submissionOrigin.current = currentScope.current
    flushSync(() => setSubmitting(true))
    setAttachmentError(null)
    setSubmissionFailure(null)
    const origin = currentScope.current
    const submittedPinned = suggestions.pinned
    try {
      await handler(suggestions.hydrate())
      if (
        currentScope.current.host === origin.host &&
        currentScope.current.scope === origin.scope &&
        currentPinned.current === submittedPinned
      )
        suggestions.clearPinned()
    } catch (error) {
      if (currentScope.current.host === origin.host && currentScope.current.scope === origin.scope)
        setSubmissionFailure({ scope: scopeKey, message: errorText(error) })
    } finally {
      submissionPending.current = false
      setSubmitting(false)
    }
  }
  const submit = () => {
    void send(onSubmit)
  }
  const alternate = () => {
    if (onAlternateSubmit) void send(onAlternateSubmit)
  }
  const [modHeld, setModHeld] = useState(false)
  const hasAlternate = !!onAlternateSubmit && !!alternateLabel
  useEffect(() => {
    if (!hasAlternate) return setModHeld(false)
    const sync = (e: KeyboardEvent) => setModHeld(e.metaKey || e.ctrlKey)
    const clear = () => setModHeld(false)
    window.addEventListener('keydown', sync)
    window.addEventListener('keyup', sync)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', sync)
      window.removeEventListener('keyup', sync)
      window.removeEventListener('blur', clear)
    }
  }, [hasAlternate])
  const hasPinned = suggestions.pinned.length > 0
  const hasContent = allowEmpty || hasPinned || value.trim().length > 0 || attachments.length > 0
  const canAlternate = !viewOnly && !submitting && !alternateDisabled && !uploading && !dictating && hasContent
  const showStop =
    !submitting && !allowEmpty && !hasPinned && !!stop?.active && !value.trim() && attachments.length === 0
  const showAlternate = modHeld && hasAlternate
  const showResume =
    !submitting &&
    !allowEmpty &&
    !hasPinned &&
    !showStop &&
    !!resume?.active &&
    !value.trim() &&
    attachments.length === 0
  const rootRef = useRef<HTMLDivElement>(null)
  const [showAllChips, setShowAllChips] = useState(false)
  // Explorer entries become context; desktop files become attachments and folders become path references.
  const handleDrop = (dragged: string, files: File[]) => {
    if (viewOnly) return
    if (dragged) {
      pendingUploads.current++
      setUploading(true)
      void (async () => {
        try {
          const item = JSON.parse(dragged) as {
            repoId: string
            path: string
            kind?: 'file' | 'dir'
            items?: { path: string; kind?: 'file' | 'dir' }[]
          }
          if (!item.repoId) return
          const list = item.items?.length
            ? item.items
            : typeof item.path === 'string'
              ? [{ path: item.path, kind: item.kind }]
              : []
          const picked: { repoId: string; path: string }[] = []
          let all: { repoId: string; path: string }[] | null = null
          for (const entry of list) {
            if (entry.kind !== 'dir') {
              picked.push({ repoId: item.repoId, path: entry.path })
              continue
            }
            // A folder adds the files inside it.
            all ??= await invoke('files.all', suggestions.scope ?? '')
            const prefix = entry.path ? `${entry.path}/` : ''
            picked.push(...all.filter((file) => file.repoId === item.repoId && file.path.startsWith(prefix)))
          }
          if (!picked.length) {
            setAttachmentError('Nothing to add: those folders have no files.')
            return
          }
          const dropped = suggestions.pinMany(picked)
          setAttachmentError(
            dropped
              ? `Only ${MAX_PINNED_FILES} files can be added as context per message. ${dropped} ${dropped === 1 ? 'was' : 'were'} left out.`
              : null,
          )
        } catch (error) {
          setAttachmentError(errorText(error))
        } finally {
          if (--pendingUploads.current === 0) setUploading(false)
        }
        requestAnimationFrame(() => ref.current?.focus())
      })()
      return
    }
    if (onAttachmentsChange && files.length) void importFiles(files, true)
  }
  // The whole chat accepts drops (see AgentView); it hands them to the composer in the same pane.
  const latestDrop = useRef(handleDrop)
  latestDrop.current = handleDrop
  useEffect(() => {
    const onChatDrop = (event: Event) => {
      const { root, dragged, files } = (event as CustomEvent<{ root: Element; dragged: string; files: File[] }>).detail
      if (rootRef.current?.closest('.agent-view') === root) latestDrop.current(dragged, files)
    }
    window.addEventListener('ramu:chat-drop', onChatDrop)
    return () => window.removeEventListener('ramu:chat-drop', onChatDrop)
  }, [])
  const canSend = !submitting && !disabled && !viewOnly && !uploading && !dictating && hasContent
  return (
    <>
      <div
        ref={rootRef}
        className={`composer${dragging ? ' dragging' : ''}`}
        onDragOver={(event) => {
          if (
            event.dataTransfer.types.includes(FILE_DRAG_TYPE) ||
            (onAttachmentsChange && event.dataTransfer.types.includes('Files'))
          ) {
            event.preventDefault()
            setDragging(true)
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={(event) => {
          const dragged = event.dataTransfer.getData(FILE_DRAG_TYPE),
            files = [...event.dataTransfer.files]
          if (dragged || (onAttachmentsChange && files.length)) {
            event.preventDefault()
            setDragging(false)
            handleDrop(dragged, files)
          }
        }}
      >
        {suggestions.visible && <ComposerSuggestions suggestions={suggestions} onChoose={choose} />}
        {(chips || hasPinned) && (
          <div className="composer-chips [&_.comments-chip-wrap]:m-0 [&_.attachment-chip]:min-h-0 [&_.attachment-chip]:h-6 [&_.attachment-chip]:max-w-[180px] [&_.attachment-chip]:rounded-(--radius-s) [&_.attachment-chip]:text-caption [&_.attachment-chip_.attachment-open.file]:gap-[5px] [&_.attachment-chip_.attachment-open.file]:p-[0_9px_0_7px] [&_.attachment-chip_.attachment-open.file]:h-full [&_.attachment-chip_.attachment-open.file]:items-center [&_.attachment-chip_.attachment-open.file]:text-caption [&_.attachment-chip_.attachment-open.file_svg]:w-[13px] [&_.attachment-chip_.attachment-open.file_svg]:h-[13px] [&_.attachment-chip_.attachment-name]:text-caption [&_.comments-chip-x]:w-[18px] [&_.comments-chip-x]:h-[18px] [&_.comments-chip-x]:right-[3px] [&_.comments-chip-x_svg]:w-[11px] [&_.comments-chip-x_svg]:h-[11px] [&_.chip-more]:h-6 [&_.chip-more]:p-[0_8px] [&_.chip-more]:rounded-(--radius-s) [&_.chip-more]:text-caption [&_.comments-chip:hover_.attachment-open.file]:[mask-image:linear-gradient(to_right,_#000_calc(100%_-_38px),_transparent_calc(100%_-_12px))] [&_.comments-chip:focus-within_.attachment-open.file]:[mask-image:linear-gradient(to_right,_#000_calc(100%_-_38px),_transparent_calc(100%_-_12px))] [&_.attachment-chip_button.comments-chip-x]:w-[18px] [&_.attachment-chip_button.comments-chip-x]:h-[18px] [&_.attachment-chip_button.comments-chip-x]:right-[3px] flex flex-wrap items-center gap-1 m-[0_0_4px]">
            {chips}
            {(showAllChips ? suggestions.pinned : suggestions.pinned.slice(0, CHIPS_SHOWN)).map((file) => (
              <span
                key={`${file.repoId}:${file.path}`}
                className="attachment-chip [&_img]:w-[36px] [&_img]:h-[36px] [&_img]:object-cover [&_img]:rounded-(--radius-xs) [&_button]:flex-none [&_svg]:flex-none [&_.attachment-open.file]:inline-flex [&_.attachment-open.file]:items-center [&_.attachment-open.file]:gap-[7px] [&_.attachment-open.file]:p-[5px_9px] [&_.attachment-open.file]:max-w-[240px] [&_.attachment-open.file]:bg-transparent [&_.attachment-open.file]:[border:0] [&_.attachment-open.file]:text-left [&_.attachment-open.file]:justify-start [&_.attachment-open.file]:cursor-pointer [&_.attachment-remove]:top-[-7px] [&_.attachment-remove]:right-[-7px] [&:not(.comments-chip)_.attachment-remove]:opacity-0 [&:not(.comments-chip)_.attachment-remove]:[transition:none] [&:hover_.attachment-remove]:opacity-100 [&:hover_.attachment-remove]:[transition:opacity_0.12s_var(--ease)] [&_button.comments-chip-x]:absolute [&_button.comments-chip-x]:top-[50%] [&_button.comments-chip-x]:right-1 [&_button.comments-chip-x]:bottom-auto [&_button.comments-chip-x]:left-auto [&_button.comments-chip-x]:w-5 [&_button.comments-chip-x]:h-5 [&_button.comments-chip-x]:min-w-0 [&_button.comments-chip-x]:min-h-0 [&_button.comments-chip-x]:m-0 [&_button.comments-chip-x]:p-0 [&_button.comments-chip-x]:grid [&_button.comments-chip-x]:place-items-center [&_button.comments-chip-x]:[border:0] [&_button.comments-chip-x]:rounded-full [&_button.comments-chip-x]:[transform:translateY(-50%)] [&_button.comments-chip-x]:opacity-0 [&_button.comments-chip-x]:[transition:none] [&:hover_button.comments-chip-x]:opacity-100 [&:hover_button.comments-chip-x]:[transition:opacity_0.12s_var(--ease)] [&_button.comments-chip-x:focus-visible]:opacity-100 [&_button.comments-chip-x:focus-visible]:[transition:opacity_0.12s_var(--ease)] inline-flex items-center gap-[7px] max-w-[240px] min-w-0 [border:1px_solid_transparent] rounded-(--radius-s) text-control whitespace-normal relative p-0 bg-hover comments-chip [&:focus-visible]:[border-color:var(--line-strong)] [&_.attachment-open.file]:pr-3 [&_.attachment-open.file]:[transition:none] [&:hover_.attachment-open.file]:pr-[30px] [&:hover_.attachment-open.file]:[mask-image:linear-gradient(to_right,_#000_calc(100%_-_52px),_transparent_calc(100%_-_14px))] [&:focus-within_.attachment-open.file]:pr-[30px] [&:focus-within_.attachment-open.file]:[mask-image:linear-gradient(to_right,_#000_calc(100%_-_52px),_transparent_calc(100%_-_14px))] [&:hover_.comments-chip-x]:opacity-100 [outline:0] relative"
                title={`${suggestions.repoName(file.repoId)}/${file.path}`}
              >
                <span className="attachment-open file">
                  <FileText size={15} />
                  <span className="attachment-name [&_small]:block [&_small]:text-caption min-w-0 [overflow-wrap:anywhere]">
                    {file.path.slice(file.path.lastIndexOf('/') + 1)}
                  </span>
                </span>
                <Button
                  variant="secondary"
                  size="icon-xs"
                  type="button"
                  className="bg-fill hover:bg-fill-hover comments-chip-x [&:focus-visible]:opacity-100 [&:hover]:[background:linear-gradient(var(--hover),_var(--hover)),_linear-gradient(var(--pressed),_var(--pressed)),_var(--canvas)] absolute top-[50%] [transform:translateY(-50%)] grid place-items-center p-0 [border:0] rounded-full opacity-0 cursor-pointer [transition:opacity_0.12s_var(--ease)] w-[22px] h-[22px] right-[5px] [box-shadow:inset_0_0_0_1px_var(--line-strong)] text-foreground [background:linear-gradient(var(--pressed),_var(--pressed)),_var(--canvas)]"
                  aria-label={t('Remove {0}', { '0': file.path })}
                  onClick={() => {
                    suggestions.unpin(file)
                    setAttachmentError(null)
                  }}
                >
                  <X size={13} />
                </Button>
              </span>
            ))}
            {suggestions.pinned.length > CHIPS_SHOWN && (
              <Button
                variant="secondary"
                type="button"
                className="bg-fill hover:bg-fill-hover chip-more [&:hover]:text-foreground [&:hover]:bg-hover [&.clear]:ml-auto [&.clear]:[border-style:solid] h-7 p-[0_10px] [border:1px_dashed_var(--line-strong)] rounded-(--radius-row) bg-transparent text-muted-foreground text-caption cursor-pointer"
                onClick={() => setShowAllChips((value) => !value)}
              >
                {showAllChips ? t('Show less') : t('+{0} more', { '0': suggestions.pinned.length - CHIPS_SHOWN })}
              </Button>
            )}
            {suggestions.pinned.length + attachments.length > 1 && (
              <Button
                variant="secondary"
                type="button"
                className="bg-fill hover:bg-fill-hover chip-more [&:hover]:text-foreground [&:hover]:bg-hover [&.clear]:ml-auto [&.clear]:[border-style:solid] h-7 p-[0_10px] [border:1px_dashed_var(--line-strong)] rounded-(--radius-row) bg-transparent text-muted-foreground text-caption cursor-pointer clear"
                onClick={() => {
                  suggestions.clearPinned()
                  setAttachmentError(null)
                  setShowAllChips(false)
                  if (attachments.length) onAttachmentsChange?.([])
                }}
              >
                {t('Clear all')}
              </Button>
            )}
          </div>
        )}
        {attachments.length > 0 && (
          <Attachments
            files={attachments}
            onRemove={(id) => onAttachmentsChange?.(attachments.filter((file) => file.id !== id))}
          />
        )}
        {viewOnly && (
          <div className="text-muted-foreground small text-caption" role="status">
            {t(VIEW_ONLY_NOTICE)}
          </div>
        )}
        {attachmentError && (
          <div className="error text-bad small text-caption" role="alert">
            {attachmentError}
          </div>
        )}
        {submissionFailure?.scope === scopeKey && (
          <div className="error text-bad small text-caption" role="alert">
            {submissionFailure.message}
          </div>
        )}
        {(micVisible || dictation.snapshot.state.phase !== 'idle') && (
          <DictationStatus
            state={dictation.snapshot.state}
            level={dictation.snapshot.level}
            onStop={() => dictation.session.stop()}
            onCancel={() => dictation.session.cancel()}
            onDismiss={() => dictation.session.cancel()}
            onInsert={() => {
              const input = ref.current
              const position = input?.selectionStart ?? latestValue.current.length
              takeSelection.current = { start: position, end: input?.selectionEnd ?? position }
              if (
                !dictation.session.insertReview(
                  { draftKey: dictationKey, revision: revision.current, text: latestValue.current },
                  { ...takeSelection.current },
                )
              )
                dictation.session.cancel()
            }}
            onOpenSettings={() => void window.ramu.voice?.openSettings()}
          />
        )}
        <ComposerInput
          ref={ref}
          readOnly={dictating || submitting}
          autoFocus={autoFocus}
          value={
            submitting &&
            submissionOrigin.current?.host === checkpointHost &&
            submissionOrigin.current?.scope === suggestions.scope
              ? ''
              : value
          }
          placeholder={dictation.snapshot.state.phase === 'recording' ? t('Listening…') : t(placeholder)}
          onPaste={(event) => {
            if (!onAttachmentsChange) return
            const files = [...event.clipboardData.files]
            if (files.length) {
              event.preventDefault()
              void importFiles(files)
              return
            }
            const text = event.clipboardData.getData('text/plain')
            if (text.length < PASTE_ATTACHMENT_CHARACTERS && text.split(/\r\n|\r|\n/).length < PASTE_ATTACHMENT_LINES)
              return
            event.preventDefault()
            const number = ++pastedCount.current
            const name = number === 1 ? 'Pasted text.txt' : `Pasted text ${number}.txt`
            void importFiles([new File([text], name, { type: 'text/plain;charset=utf-8' })]).then((attached) => {
              if (attached || !ref.current) return
              // Too big for a message anyway (the attachment error says why): inserting it would only freeze the editor.
              if (text.length > MAX_MESSAGE_CHARACTERS) return
              // Preserve the paste if storage fails or the attachment limit is reached.
              const input = ref.current
              const position = input.selectionStart + text.length
              input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end')
              setCaret(position)
              requestAnimationFrame(() => {
                input.focus()
                input.setSelectionRange(position, position)
              })
            })
          }}
          aria-autocomplete="list"
          aria-controls={suggestions.visible ? suggestions.listId : undefined}
          aria-expanded={suggestions.visible}
          aria-activedescendant={
            suggestions.visible && suggestions.choices.length
              ? `${suggestions.listId}-${suggestions.selected}`
              : undefined
          }
          onClick={() => setCaret(ref.current?.selectionStart ?? value.length)}
          onKeyUp={() => setCaret(ref.current?.selectionStart ?? value.length)}
          onChange={(next, position) => {
            onChange(next)
            setCaret(position)
          }}
          onKeyDown={(e) => {
            if (suggestions.visible && !e.nativeEvent.isComposing) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                suggestions.move(e.key === 'ArrowDown' ? 1 : -1)
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                suggestions.dismiss()
                return
              }
              if (((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') && suggestions.choices.length) {
                e.preventDefault()
                choose(suggestions.selected)
                return
              }
            }
            if (
              e.key === 'ArrowUp' &&
              onArrowUpEmpty &&
              !value &&
              !e.shiftKey &&
              !e.altKey &&
              !e.metaKey &&
              !e.ctrlKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault()
              onArrowUpEmpty()
              return
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (recording) dictation.session.stop()
              else if ((e.metaKey || e.ctrlKey) && onAlternateSubmit) {
                if (canAlternate) alternate()
              } else if (canSend) submit()
            }
          }}
        />
        <div className="composer-bar">
          {onAttachmentsChange && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="icon small-icon hover:bg-fill-hover dark:hover:bg-fill-hover"
              aria-label={t('Attach files')}
              title={t('Attach files')}
              disabled={viewOnly || uploading || attachments.length >= 10}
              onClick={() => void importFiles()}
            >
              <Paperclip size={15} />
            </Button>
          )}
          {controls ? (
            <div className="composer-controls flex min-w-0 flex-1 flex-wrap items-center gap-1">{controls}</div>
          ) : (
            <span className="grow flex-1 min-w-0 text-left" />
          )}
          {micVisible && (
            <MicButton
              active={dictating}
              disabled={
                mic.kind === 'blocked' && mic.reason === 'language-unsupported' ? true : dictating && !recording
              }
              title={
                mic.kind === 'blocked'
                  ? mic.reason === 'permission-denied'
                    ? t('Microphone or speech access is off. Turn it on in system settings to dictate.')
                    : t('This computer cannot recognize the chosen language offline.')
                  : dictating
                    ? t('Stop and transcribe')
                    : t('Dictate message')
              }
              onClick={toggleDictation}
            />
          )}
          {actions}
          <Button
            variant={showStop || showResume ? 'secondary' : 'default'}
            size="icon-sm"
            className={`send${showStop ? ' stop' : showResume ? ' resume' : ''}`}
            data-alternate={showAlternate && !showStop && !showResume ? '' : undefined}
            aria-busy={submitting}
            aria-label={
              submitting
                ? t('Sending')
                : showStop
                  ? t('Stop')
                  : showResume
                    ? t(resume?.label ?? 'Resume')
                    : t(submitLabel)
            }
            title={
              submitting
                ? t('Sending')
                : showStop
                  ? t('Stop this turn')
                  : showResume
                    ? t(resume?.title ?? 'Resume where it stopped')
                    : `${t(submitLabel)} (Enter)${onAlternateSubmit && alternateLabel ? ` · ${t(alternateLabel)} (⌘Enter / Ctrl+Enter)` : ''}`
            }
            disabled={viewOnly || (showStop || showResume ? false : !canSend)}
            onClick={
              showStop
                ? stop!.onStop
                : showResume
                  ? resume!.onResume
                  : showAlternate && canAlternate
                    ? alternate
                    : submit
            }
          >
            {submitting ? (
              <Spinner aria-label={t('Sending')} />
            ) : showStop ? (
              <Square size={12} fill="currentColor" strokeWidth={0} />
            ) : showResume ? (
              <Play size={13} fill="currentColor" strokeWidth={0} />
            ) : showAlternate ? (
              alternateLabel === 'Queue' ? (
                <ListEnd key="queue" className="send-icon" size={16} strokeWidth={2.25} />
              ) : (
                <CornerDownRight key="steer" className="send-icon" size={16} strokeWidth={2.25} />
              )
            ) : (
              <ArrowUp key="send" className="send-icon" size={16} strokeWidth={2.25} />
            )}
          </Button>
        </div>
      </div>
      {footer && (
        <div className="composer-footer [&_.foot-item]:min-w-0 [&_.foot-item]:overflow-hidden [&_.foot-item]:text-ellipsis [&_.path]:font-sans flex-1 flex items-center gap-3 min-w-0 p-[7px_16px_0] text-muted-foreground text-caption">
          {footer}
        </div>
      )}
    </>
  )
}
