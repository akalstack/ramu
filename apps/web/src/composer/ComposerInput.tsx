import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type HTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { Folder, Quote, SquareTerminal, Users, WandSparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/desktop-button'
import { FileIcon } from '../editor/FileIcon'
import { ProviderIcon } from '../models/ProviderIcon'
import { REFERENCE_CHIP } from '../chat/ReferenceChipView'
import { composerDraft, deleteDraftAtom, type DraftChip, type DraftMention } from '@ramu/shared/chat/composerDraft'
import { markdownRuns, toggleMarkdownWrap } from '@ramu/shared/chat/markdownRuns'
import { isFolderLike } from '@ramu/shared/chat/referenceChip'
import { localFileLink } from '@ramu/shared/workspace/fileLinks'
import { t } from '../i18n'

export interface ComposerInputHandle {
  focus(): void
  setSelectionRange(start: number, end: number): void
  setRangeText(text: string, start: number, end: number, mode?: string): void
  readonly selectionStart: number
  readonly selectionEnd: number
  readonly value: string
}

export function composerInputText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node instanceof HTMLElement) {
    if (node.hasAttribute('data-composer-input') && !node.textContent && !node.querySelector('[data-source]')) return ''
    if (node.dataset.source !== undefined) return node.dataset.source
    if (node.tagName === 'BR') return '\n'
  }
  if (node.childNodes.length === 1 && node.firstChild instanceof HTMLElement && node.firstChild.tagName === 'BR')
    return ''
  let result = ''
  for (const child of node.childNodes) {
    if (child instanceof HTMLElement && /^(DIV|P)$/.test(child.tagName) && result && !result.endsWith('\n'))
      result += '\n'
    result += composerInputText(child)
  }
  return result
}

function offsets(root: HTMLElement) {
  const selection = document.getSelection()
  if (!selection?.rangeCount || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {
    const end = composerInputText(root).length
    return { start: end, end }
  }
  const range = selection.getRangeAt(0)
  const prefix = document.createRange()
  prefix.selectNodeContents(root)
  prefix.setEnd(range.startContainer, range.startOffset)
  const start = composerInputText(prefix.cloneContents()).length
  return { start, end: start + composerInputText(range.cloneContents()).length }
}

export function selectComposerInput(root: HTMLElement, start: number, end = start) {
  const point = (offset: number): [Node, number] => {
    let consumed = 0
    for (const child of root.childNodes) {
      const length = composerInputText(child).length
      if (offset <= consumed + length) {
        if (child.nodeType === Node.TEXT_NODE) return [child, Math.max(0, Math.min(length, offset - consumed))]
        // Styled Markdown is ordinary text inside a span; only chips are stepped over as one character block.
        if (child instanceof HTMLElement && child.dataset.md !== undefined && child.firstChild)
          return [child.firstChild, Math.max(0, Math.min(length, offset - consumed))]
        const index = Array.from(root.childNodes).indexOf(child)
        return [root, index + (offset > consumed ? 1 : 0)]
      }
      consumed += length
    }
    return [root, root.childNodes.length]
  }
  const range = document.createRange(),
    [a, x] = point(start),
    [b, y] = point(end)
  range.setStart(a, x)
  range.setEnd(b, y)
  const selection = document.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

export function focusComposer(root: Element | null, caret?: number) {
  const input = root?.querySelector<HTMLElement>('[data-composer-input]')
  input?.focus()
  if (input && caret !== undefined) selectComposerInput(input, caret)
}

/** What a chip stands for, in full, for its popover: a quote's text, a file's path, a skill's or command's name. */
function chipDetail(chip: DraftChip) {
  if (chip.kind === 'quote') return chip.label
  if (chip.kind === 'mention') return t('This message goes to {0}', { '0': chip.label })
  if (chip.kind === 'file') return localFileLink(chip.target!)?.path ?? chip.target!
  return chip.source
}

/**
 * One reference in the draft. A file or folder opens at once on a press, with its path in the tooltip; Backspace removes
 * it like any other atom. Other references open a popover with what they stand for in full and what can be done with
 * them: find a quote's source in the conversation, or remove the reference.
 */
export function InlineChip({
  chip,
  onOpen,
  onFind,
  onRemove,
}: {
  chip: DraftChip
  onOpen?: (target: string) => void
  /** Finds a quote's source in the conversation; absent outside a thread. */
  onFind?: (text: string) => void
  onRemove?: () => void
}) {
  const [open, setOpen] = useState(false)
  const target = chip.kind === 'file' ? chip.target : undefined
  const path = target !== undefined ? (localFileLink(target)?.path ?? target) : undefined
  const folder = path !== undefined && isFolderLike(path)
  const detail = chipDetail(chip)
  const act = (run: () => void) => () => {
    setOpen(false)
    run()
  }
  const content = (
    <>
      {folder ? (
        <Folder data-icon="inline-start" aria-hidden="true" />
      ) : chip.kind === 'skill' ? (
        <WandSparkles data-icon="inline-start" className="text-brand" aria-hidden="true" />
      ) : chip.kind === 'file' ? (
        <FileIcon path={path!} />
      ) : chip.kind === 'quote' ? (
        <Quote data-icon="inline-start" aria-hidden="true" />
      ) : chip.kind === 'mention' ? (
        chip.provider ? (
          <ProviderIcon provider={chip.provider} size={14} />
        ) : (
          <Users data-icon="inline-start" aria-hidden="true" />
        )
      ) : (
        <SquareTerminal data-icon="inline-start" aria-hidden="true" />
      )}
      <span className="truncate">{chip.label.replace(/\n/g, ' ')}</span>
    </>
  )
  // The chip is one atom in the draft: a press acts on it instead of moving the caret.
  const keepCaret = (event: React.MouseEvent) => event.preventDefault()
  if (target !== undefined && onOpen)
    return (
      <Badge
        variant="secondary"
        {...REFERENCE_CHIP}
        role="button"
        title={detail}
        onMouseDown={keepCaret}
        onClick={() => onOpen(target)}
      >
        {content}
      </Badge>
    )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        nativeButton={false}
        render={
          <Badge
            variant="secondary"
            {...REFERENCE_CHIP}
            title={chip.kind === 'mention' ? `@${chip.target}` : detail}
            onMouseDown={keepCaret}
          />
        }
      >
        {content}
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[min(360px,calc(100vw-16px))] gap-2 p-3">
        <p
          className={`m-0 max-h-48 overflow-y-auto text-control whitespace-pre-wrap break-words ${chip.kind === 'quote' ? 'border-l-2 border-(--line-strong) pl-2.5 text-soft' : 'font-mono text-caption text-muted-foreground'}`}
        >
          {detail}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {chip.kind === 'quote' && onFind && (
            <Button size="sm" variant="secondary" onClick={act(() => onFind(chip.label))}>
              {t('Show in conversation')}
            </Button>
          )}
          {path && (
            <Button size="sm" variant="ghost" onClick={act(() => void navigator.clipboard.writeText(path))}>
              {t('Copy path')}
            </Button>
          )}
          {onRemove && (
            <Button size="sm" variant="ghost" onClick={act(onRemove)}>
              {t('Remove')}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Formatting shortcuts while writing. They wrap the text in Markdown, so the draft stays plain characters. */
const WRAP: Record<string, string> = { b: '**', i: '*', e: '`' }

type Props = Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  value: string
  onChange: (value: string, caret: number) => void
  placeholder: string
  autoFocus?: boolean
  /** The draft is frozen, e.g. while a dictation take is running, so the insertion point cannot move under it. */
  readOnly?: boolean
  /** Who a message can start with; a leading `@handle` naming one draws as that model or teammate. */
  mentions?: readonly DraftMention[]
  /** Opens a referenced file or folder from its chip. */
  onOpenFile?: (target: string) => void
  /** Finds a quote's source in the conversation, from its chip. */
  onFindQuote?: (text: string) => void
}
const NO_MENTIONS: readonly DraftMention[] = []
export const ComposerInput = forwardRef<ComposerInputHandle, Props>(function ComposerInput(
  {
    value,
    onChange,
    placeholder,
    autoFocus,
    readOnly,
    mentions = NO_MENTIONS,
    onOpenFile,
    onFindQuote,
    onKeyDown,
    onPaste,
    ...props
  },
  forwarded,
) {
  // The list is rebuilt on every render upstream; its contents decide when the chips are drawn again.
  const mentionKey = mentions.map((entry) => `${entry.handle}=${entry.label}:${entry.provider ?? ''}`).join('|')
  const root = useRef<HTMLDivElement>(null),
    composing = useRef(false),
    pendingCaret = useRef<number | null>(null),
    pendingSelectionEnd = useRef<number | null>(null),
    mounted = useRef(false)
  const current = useRef(value)
  current.current = value
  const [portals, setPortals] = useState<{ node: HTMLElement; chip: DraftChip }[]>([])
  const history = useRef<{
    past: { value: string; caret: number }[]
    future: { value: string; caret: number }[]
    lastAt: number
  }>({ past: [], future: [], lastAt: 0 })
  const lastRendered = useRef(value),
    internalChange = useRef(false)
  const commit = (next: string, caret: number, group = false) => {
    const now = Date.now()
    if (!group || now - history.current.lastAt > 600 || !history.current.past.length)
      history.current.past.push({
        value: current.current,
        caret: root.current ? offsets(root.current).start : current.current.length,
      })
    history.current.past = history.current.past.slice(-100)
    history.current.future = []
    history.current.lastAt = now
    pendingCaret.current = caret
    internalChange.current = true
    onChange(next, caret)
  }
  useImperativeHandle(forwarded, () => ({
    focus: () => root.current?.focus(),
    setSelectionRange: (start, end) => {
      if (root.current) selectComposerInput(root.current, start, end)
    },
    setRangeText: (text, start, end) => {
      const next = current.current.slice(0, start) + text + current.current.slice(end)
      commit(next, start + text.length)
    },
    get selectionStart() {
      return root.current ? offsets(root.current).start : current.current.length
    },
    get selectionEnd() {
      return root.current ? offsets(root.current).end : current.current.length
    },
    get value() {
      return root.current ? composerInputText(root.current) : current.current
    },
  }))
  useLayoutEffect(() => {
    const element = root.current
    if (!element || composing.current) return
    const focused = document.activeElement === element
    // Text that arrives from outside into an empty box (a restored draft, a quote) leaves the caret after it.
    const filled = !internalChange.current && !lastRendered.current && !!value
    const caret = pendingCaret.current ?? (focused && !filled ? offsets(element).start : value.length)
    if (lastRendered.current !== value && !internalChange.current) {
      if (!value) {
        history.current.past = []
        history.current.future = []
      } else history.current.past.push({ value: lastRendered.current, caret })
    }
    internalChange.current = false
    lastRendered.current = value
    pendingCaret.current = null
    const selectionEnd = pendingSelectionEnd.current ?? caret
    pendingSelectionEnd.current = null
    const nodes: Node[] = [],
      chips: { node: HTMLElement; chip: DraftChip }[] = []
    for (const segment of composerDraft(value, mentions).segments) {
      if (segment.kind === 'text') {
        for (const run of markdownRuns(segment.source)) {
          if (!run.marks.length) {
            nodes.push(document.createTextNode(run.text))
            continue
          }
          const node = document.createElement('span')
          node.dataset.md = run.marks.join(' ')
          node.textContent = run.text
          nodes.push(node)
        }
      } else {
        const node = document.createElement('span')
        node.contentEditable = 'false'
        node.dataset.source = segment.source
        node.className = 'composer-inline-atom'
        nodes.push(node)
        chips.push({ node, chip: segment })
      }
    }
    nodes.push(document.createTextNode(''))
    element.replaceChildren(...nodes)
    setPortals(chips)
    // Autofocus also covers a box that mounts with a draft already in it.
    if (focused || (autoFocus && (!value || !mounted.current))) {
      element.focus()
      selectComposerInput(element, Math.min(caret, value.length), Math.min(selectionEnd, value.length))
    }
    mounted.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [value, mentionKey] by design; the values it reads beyond these are current as of that run
  }, [value, mentionKey])
  const insert = (text: string) => {
    const position = root.current ? offsets(root.current) : { start: value.length, end: value.length }
    commit(value.slice(0, position.start) + text + value.slice(position.end), position.start + text.length)
  }
  return (
    <>
      <div
        {...props}
        ref={root}
        data-composer-input=""
        data-draft={value}
        data-empty={!value || undefined}
        data-placeholder={placeholder}
        contentEditable={!readOnly}
        role="textbox"
        aria-multiline="true"
        aria-readonly={readOnly || undefined}
        aria-label={placeholder}
        suppressContentEditableWarning
        onInput={() => {
          if (!composing.current && root.current)
            commit(composerInputText(root.current), offsets(root.current).start, true)
        }}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
          if (root.current) commit(composerInputText(root.current), offsets(root.current).start)
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (event.defaultPrevented || event.nativeEvent.isComposing) return
          const position = root.current ? offsets(root.current) : { start: value.length, end: value.length }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
            event.preventDefault()
            const stack = event.shiftKey ? history.current.future : history.current.past,
              target = stack.pop()
            if (target) {
              ;(event.shiftKey ? history.current.past : history.current.future).push({ value, caret: position.start })
              pendingCaret.current = target.caret
              internalChange.current = true
              onChange(target.value, target.caret)
            }
            return
          }
          const marker =
            (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && WRAP[event.key.toLowerCase()]
          if (marker) {
            event.preventDefault()
            const next = toggleMarkdownWrap(value, position.start, position.end, marker)
            pendingSelectionEnd.current = next.end
            commit(next.value, next.start)
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            insert('\n')
            return
          }
          if (position.start === position.end && (event.key === 'Backspace' || event.key === 'Delete')) {
            const next = deleteDraftAtom(value, position.start, event.key, mentions)
            if (next) {
              event.preventDefault()
              commit(next.value, next.caret)
            }
          }
        }}
        onPaste={(event) => {
          onPaste?.(event)
          if (!event.defaultPrevented) {
            event.preventDefault()
            insert(event.clipboardData.getData('text/plain'))
          }
        }}
        onCopy={(event) => {
          if (root.current) {
            const position = offsets(root.current)
            event.preventDefault()
            event.clipboardData.setData('text/plain', value.slice(position.start, position.end))
          }
        }}
        onCut={(event) => {
          if (root.current) {
            const position = offsets(root.current)
            event.preventDefault()
            event.clipboardData.setData('text/plain', value.slice(position.start, position.end))
            commit(value.slice(0, position.start) + value.slice(position.end), position.start)
          }
        }}
      />
      {portals.map(({ node, chip }) =>
        createPortal(
          <InlineChip
            chip={chip}
            onOpen={onOpenFile}
            onFind={onFindQuote}
            onRemove={
              readOnly
                ? undefined
                : () => {
                    const at = current.current.indexOf(chip.source)
                    if (at < 0) return
                    commit(current.current.slice(0, at) + current.current.slice(at + chip.source.length), at)
                  }
            }
          />,
          node,
          `${chip.start}:${chip.kind}`,
        ),
      )}
    </>
  )
})
