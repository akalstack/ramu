import { useEffect, useRef, useState } from 'react'
import { Editor, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Image from '@tiptap/extension-image'
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  SquareCode,
  Link,
  Table,
  Undo2,
  Redo2,
} from 'lucide-react'
import { previewUrlTransform } from '@ramu/shared/workspace/markdownRendering'
import { markdownLinkTarget, previewImagePath, type MarkdownLinkTarget } from '@ramu/shared/workspace/fileLinks'
import { Button } from '@/components/desktop-button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { Dialog, Menu } from '../Menu'
import { useHost } from '../workspace/HostProvider'
import { t, useLanguage } from '../i18n'
import { registerSelection } from './editorBuffers'
import type { monaco } from './monaco'
import './markdown-document.css'
import './markdown-editor.css'

// Keep HTML blocks as editable source instead of dropping attributes or executing embedded markup.
const RawHtml = Node.create({
  name: 'rawHtml',
  group: 'block',
  content: 'text*',
  code: true,
  marks: '',
  defining: true,
  parseHTML: () => [{ tag: 'pre[data-raw-html]' }],
  renderHTML: () => ['pre', { 'data-raw-html': '' }, ['code', {}, 0]],
  markdownTokenName: 'rawHtml',
  markdownTokenizer: {
    name: 'rawHtml',
    level: 'block',
    start: (source) => source.search(/^ {0,3}<[A-Za-z!/]/m),
    tokenize: (source) => {
      const match = /^ {0,3}<[A-Za-z!/][\s\S]*?(?:\n[ \t]*\n|$)/.exec(source)
      return match ? { type: 'rawHtml', raw: match[0], text: match[0].trimEnd() } : undefined
    },
  },
  parseMarkdown: (token) => ({ type: 'rawHtml', content: token.text ? [{ type: 'text', text: token.text }] : [] }),
  renderMarkdown: (node) => node.content?.map((child) => child.text ?? '').join('') ?? '',
})

const splitMetadata = (text: string) => {
  const prefix = /^(?:\uFEFF)?(?:---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$))?/.exec(text)?.[0] ?? ''
  return { prefix, body: text.slice(prefix.length) }
}

/** Rich text is serialized into the shared source buffer; opening a file alone never rewrites it. */
export function MarkdownEditor({
  model,
  viewId,
  taskId,
  repoId,
  path,
  onSave,
  onOpenLink,
}: {
  model: monaco.editor.ITextModel
  viewId: string
  taskId: string
  repoId: string
  path: string
  onSave: () => void
  onOpenLink: (target: MarkdownLinkTarget) => void
}) {
  useLanguage()
  const { invoke } = useHost()
  const host = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onSave, onOpenLink })
  callbacks.current = { onSave, onOpenLink }
  const [editor, setEditor] = useState<Editor | null>(null)
  const [, refresh] = useState(0)
  const [linkUrl, setLinkUrl] = useState<string | null>(null)
  useEffect(() => {
    let syncing = false,
      disposed = false
    let metadata = splitMetadata(model.getValue())
    let trailingNewline = /\r?\n$/.test(model.getValue())
    let boundary: ReturnType<typeof setTimeout> | undefined
    const rich = new Editor({
      element: host.current!,
      extensions: [
        StarterKit.configure({ undoRedo: false, underline: false, link: { openOnClick: false } }),
        Markdown,
        TableKit,
        TaskList,
        TaskItem.configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' } }),
        Image.extend({
          addNodeView() {
            return ({ node }) => {
              const image = document.createElement('img')
              let request = 0
              const render = (attributes: typeof node.attrs) => {
                const current = ++request
                image.alt = attributes.alt ?? ''
                image.title = attributes.title ?? ''
                const safe = previewUrlTransform(attributes.src ?? '')
                const local = safe ? previewImagePath(path, safe) : null
                image.removeAttribute('src')
                if (local)
                  void invoke('files.image', taskId, repoId, local).then(
                    (url) => {
                      if (!disposed && request === current) image.src = url
                    },
                    () => {},
                  )
                else if (safe) image.src = safe
              }
              render(node.attrs)
              return {
                dom: image,
                update: (next: typeof node) => {
                  if (next.type !== node.type) return false
                  render(next.attrs)
                  return true
                },
                ignoreMutation: () => true,
                destroy: () => {
                  request++
                },
              }
            }
          },
        }),
        RawHtml,
      ],
      content: metadata.body,
      contentType: 'markdown',
      editorProps: {
        attributes: {
          class: 'ramu-rich-text markdown-document',
          role: 'textbox',
          'aria-label': t('Markdown editor'),
          'aria-multiline': 'true',
        },
        handleClick: (_view, _position, event) => {
          const link = (event.target as Element).closest('a')
          if (!link || !(event.metaKey || event.ctrlKey)) return false
          const safe = previewUrlTransform(link.getAttribute('href') ?? '')
          if (!safe) return true
          const target = markdownLinkTarget(path, safe)
          if (target) callbacks.current.onOpenLink(target)
          else window.open(safe, '_blank', 'noopener,noreferrer')
          return true
        },
      },
      onTransaction: () => refresh((value) => value + 1),
      onUpdate: ({ editor }) => {
        if (syncing || disposed) return
        const body = editor.getMarkdown()
        const next = metadata.prefix + body + (trailingNewline && !body.endsWith('\n') ? '\n' : '')
        if (next.replace(/\r\n/g, '\n') === model.getValue().replace(/\r\n/g, '\n')) return
        syncing = true
        try {
          model.pushEditOperations([], [{ range: model.getFullModelRange(), text: next }], () => null)
        } finally {
          syncing = false
        }
        clearTimeout(boundary)
        boundary = setTimeout(() => {
          if (!model.isDisposed()) model.pushStackElement()
        }, 500)
      },
    })
    setEditor(rich)
    model.pushStackElement()
    const changed = model.onDidChangeContent(() => {
      if (syncing) return
      metadata = splitMetadata(model.getValue())
      trailingNewline = /\r?\n$/.test(model.getValue())
      const { from, to } = rich.state.selection
      syncing = true
      try {
        rich.commands.setContent(metadata.body, { contentType: 'markdown', emitUpdate: false })
        const end = rich.state.doc.content.size
        rich.commands.setTextSelection({ from: Math.min(from, end), to: Math.min(to, end) })
      } finally {
        syncing = false
      }
    })
    const keydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'end' || key === 'home' || (event.metaKey && (key === 'arrowdown' || key === 'arrowup'))) {
        event.preventDefault()
        event.stopImmediatePropagation()
        const end = key === 'end' || key === 'arrowdown'
        if (event.shiftKey)
          rich.commands.setTextSelection({
            from: rich.state.selection.anchor,
            to: end ? rich.state.doc.content.size : 0,
          })
        else rich.commands.focus(end ? 'end' : 'start')
        rich.commands.scrollIntoView()
        return
      }
      if (key !== 's' && key !== 'z' && key !== 'y') return
      event.preventDefault()
      event.stopImmediatePropagation()
      model.pushStackElement()
      if (key === 's') callbacks.current.onSave()
      else if (key === 'y' || event.shiftKey) void model.redo()
      else void model.undo()
    }
    rich.view.dom.addEventListener('keydown', keydown, true)
    const unregister = registerSelection(viewId, () => {
      const { from, to, empty } = rich.state.selection
      if (empty || !host.current?.getClientRects().length) return
      const content = rich.state.doc.textBetween(from, to, '\n')
      if (!content) return
      const source = model.getValue()
      const match = source.indexOf(content)
      const offset =
        match >= 0
          ? match
          : Math.min(
              source.length,
              metadata.prefix.length + (rich.markdown?.serialize(rich.state.doc.cut(0, from).toJSON()).length ?? 0),
            )
      const start = model.getPositionAt(offset),
        end = model.getPositionAt(Math.min(source.length, offset + content.length))
      return {
        content,
        selection: {
          startLine: start.lineNumber,
          startColumn: start.column,
          endLine: end.lineNumber,
          endColumn: end.column,
        },
      }
    })
    return () => {
      disposed = true
      clearTimeout(boundary)
      if (!model.isDisposed()) model.pushStackElement()
      unregister()
      changed.dispose()
      rich.view.dom.removeEventListener('keydown', keydown, true)
      rich.destroy()
    }
  }, [model, viewId, taskId, repoId, path, invoke])
  const run = (action: (editor: Editor) => void) => {
    if (!editor) return
    model.pushStackElement()
    action(editor)
    model.pushStackElement()
  }
  const formats = [
    { value: 'bold', label: t('Bold'), icon: Bold, action: (e: Editor) => e.chain().focus().toggleBold().run() },
    {
      value: 'italic',
      label: t('Italic'),
      icon: Italic,
      action: (e: Editor) => e.chain().focus().toggleItalic().run(),
    },
    {
      value: 'strike',
      label: t('Strikethrough'),
      icon: Strikethrough,
      action: (e: Editor) => e.chain().focus().toggleStrike().run(),
    },
    { value: 'code', label: t('Inline code'), icon: Code, action: (e: Editor) => e.chain().focus().toggleCode().run() },
    {
      value: 'bulletList',
      label: t('Bullet list'),
      icon: List,
      action: (e: Editor) => e.chain().focus().toggleBulletList().run(),
    },
    {
      value: 'orderedList',
      label: t('Numbered list'),
      icon: ListOrdered,
      action: (e: Editor) => e.chain().focus().toggleOrderedList().run(),
    },
    {
      value: 'taskList',
      label: t('Task list'),
      icon: ListTodo,
      action: (e: Editor) => e.chain().focus().toggleTaskList().run(),
    },
    {
      value: 'blockquote',
      label: t('Quote'),
      icon: Quote,
      action: (e: Editor) => e.chain().focus().toggleBlockquote().run(),
    },
    {
      value: 'codeBlock',
      label: t('Code block'),
      icon: SquareCode,
      action: (e: Editor) => e.chain().focus().toggleCodeBlock().run(),
    },
  ]
  return (
    <div className="rich-text-editor">
      <div className="rich-text-toolbar-frame">
        <div
          className="rich-text-toolbar flex flex-wrap items-center gap-0.5"
          role="toolbar"
          aria-label={t('Text formatting')}
        >
          <Menu
            label={t('Text style')}
            icon={<Heading />}
            items={[
              {
                key: 'paragraph',
                label: t('Paragraph'),
                selected: editor?.isActive('paragraph'),
                onSelect: () => run((e) => e.chain().focus().setParagraph().run()),
              },
              ...([1, 2, 3] as const).map((level) => ({
                key: `heading-${level}`,
                label: t('Heading {0}', { '0': level }),
                selected: editor?.isActive('heading', { level }),
                onSelect: () => run((e) => e.chain().focus().toggleHeading({ level }).run()),
              })),
            ]}
          />
          <ToggleGroup
            multiple
            size="default"
            spacing={0}
            value={formats.filter((format) => editor?.isActive(format.value)).map((format) => format.value)}
            onValueChange={(next) => {
              const changed = formats.find((format) => next.includes(format.value) !== !!editor?.isActive(format.value))
              if (changed) run(changed.action)
            }}
            aria-label={t('Formatting')}
          >
            {formats.map(({ value, label, icon: Icon }) => (
              <ToggleGroupItem
                key={value}
                value={value}
                aria-label={label}
                title={label}
                onMouseDown={(event) => event.preventDefault()}
              >
                <Icon />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <span className="rich-text-toolbar-divider" aria-hidden />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('Insert link')}
            title={t('Insert link')}
            onClick={() => setLinkUrl(editor?.getAttributes('link').href ?? '')}
          >
            <Link />
          </Button>
          <Menu
            label={t('Table')}
            icon={<Table />}
            items={[
              {
                key: 'insert',
                label: t('Insert table'),
                onSelect: () =>
                  run((e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()),
              },
              {
                key: 'row',
                label: t('Add row'),
                disabled: !editor?.isActive('table'),
                onSelect: () => run((e) => e.chain().focus().addRowAfter().run()),
              },
              {
                key: 'column',
                label: t('Add column'),
                disabled: !editor?.isActive('table'),
                onSelect: () => run((e) => e.chain().focus().addColumnAfter().run()),
              },
              {
                key: 'delete',
                label: t('Delete table'),
                disabled: !editor?.isActive('table'),
                onSelect: () => run((e) => e.chain().focus().deleteTable().run()),
              },
            ]}
          />
          <span className="rich-text-toolbar-divider" aria-hidden />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('Undo')}
            title={t('Undo')}
            disabled={!model.canUndo()}
            onClick={() => {
              model.pushStackElement()
              void model.undo()
              editor?.commands.focus()
            }}
          >
            <Undo2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('Redo')}
            title={t('Redo')}
            disabled={!model.canRedo()}
            onClick={() => {
              void model.redo()
              editor?.commands.focus()
            }}
          >
            <Redo2 />
          </Button>
        </div>
      </div>
      <div className="rich-text-scroll">
        <div ref={host} />
      </div>
      {linkUrl !== null && (
        <Dialog
          title={t('Insert link')}
          confirmLabel={t('Apply')}
          confirmDisabled={!!linkUrl && !previewUrlTransform(linkUrl)}
          onCancel={() => setLinkUrl(null)}
          onConfirm={() => {
            run((e) =>
              linkUrl
                ? e
                    .chain()
                    .focus()
                    .extendMarkRange('link')
                    .setLink({ href: previewUrlTransform(linkUrl) })
                    .run()
                : e.chain().focus().extendMarkRange('link').unsetLink().run(),
            )
            setLinkUrl(null)
          }}
        >
          <Field>
            <FieldLabel htmlFor={`markdown-link-${viewId}`}>{t('Link URL')}</FieldLabel>
            <Input
              id={`markdown-link-${viewId}`}
              autoFocus
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              placeholder="https://"
            />
          </Field>
        </Dialog>
      )}
    </div>
  )
}
