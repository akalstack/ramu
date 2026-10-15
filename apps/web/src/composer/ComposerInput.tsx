import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type HTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { Quote, SquareTerminal, WandSparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { FileIcon } from '../editor/FileIcon'
import { composerDraft, deleteDraftAtom, type DraftChip } from '@ramu/shared/composerDraft'

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

function InlineChip({ chip }: { chip: DraftChip }) {
  return (
    <Badge variant="secondary" className="chat-reference composer-reference" title={chip.target ?? chip.label}>
      {chip.kind === 'skill' ? (
        <WandSparkles data-icon="inline-start" className="text-brand" aria-hidden="true" />
      ) : chip.kind === 'file' ? (
        <FileIcon path={chip.target!} />
      ) : chip.kind === 'quote' ? (
        <Quote data-icon="inline-start" aria-hidden="true" />
      ) : (
        <SquareTerminal data-icon="inline-start" aria-hidden="true" />
      )}
      <span className="truncate">{chip.label.replace(/\n/g, ' ')}</span>
    </Badge>
  )
}

type Props = Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  value: string
  onChange: (value: string, caret: number) => void
  placeholder: string
  autoFocus?: boolean
}
export const ComposerInput = forwardRef<ComposerInputHandle, Props>(function ComposerInput(
  { value, onChange, placeholder, autoFocus, onKeyDown, onPaste, ...props },
  forwarded,
) {
  const root = useRef<HTMLDivElement>(null),
    composing = useRef(false),
    pendingCaret = useRef<number | null>(null)
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
    const caret = pendingCaret.current ?? (focused ? offsets(element).start : value.length)
    if (lastRendered.current !== value && !internalChange.current) {
      if (!value) {
        history.current.past = []
        history.current.future = []
      } else history.current.past.push({ value: lastRendered.current, caret })
    }
    internalChange.current = false
    lastRendered.current = value
    pendingCaret.current = null
    const nodes: Node[] = [],
      chips: { node: HTMLElement; chip: DraftChip }[] = []
    for (const segment of composerDraft(value).segments) {
      if (segment.kind === 'text') nodes.push(document.createTextNode(segment.source))
      else {
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
    if (focused || (autoFocus && !value)) {
      element.focus()
      selectComposerInput(element, Math.min(caret, value.length))
    }
  }, [value])
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
        contentEditable
        role="textbox"
        aria-multiline="true"
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
          if (event.key === 'Enter') {
            event.preventDefault()
            insert('\n')
            return
          }
          if (position.start === position.end && (event.key === 'Backspace' || event.key === 'Delete')) {
            const next = deleteDraftAtom(value, position.start, event.key)
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
      {portals.map(({ node, chip }) => createPortal(<InlineChip chip={chip} />, node, `${chip.start}:${chip.kind}`))}
    </>
  )
})
