import type { Components } from 'react-markdown'
import { cn } from 'cn'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { chatCodeComponents } from './ChatCodeBlock'
import { useRef, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { copyText } from '../ipc'
import { errorText } from '../lib/errors'
import { notifyError } from './Notifications'
import { t } from '../i18n'
import { tableClipboard } from './richCopy'

/** A table with its own Copy, which pastes as cells into a spreadsheet and as a table into a document. */
function CopyableTable({ children }: { children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null)
  const [done, setDone] = useState(false)
  const copy = () => {
    const table = frame.current?.querySelector('table')
    if (!table) return
    const { text, html } = tableClipboard(table)
    void copyText(text, html).then(
      () => {
        setDone(true)
        window.setTimeout(() => setDone(false), 1200)
      },
      (error) => notifyError(errorText(error), t('Copy table')),
    )
  }
  return (
    <div ref={frame} className="group/table relative my-3 w-fit max-w-full">
      <div className="overflow-hidden rounded-lg border border-line bg-card/50">
        <Table className="w-auto border-collapse border-spacing-0 text-control">{children}</Table>
      </div>
      <Button
        variant="secondary"
        size="icon-xs"
        className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover/table:opacity-100 focus-visible:opacity-100"
        aria-label={t('Copy table')}
        title={t('Copy table')}
        onClick={copy}
      >
        {done ? <Check size={13} /> : <Copy size={13} />}
      </Button>
    </div>
  )
}

/**
 * Markdown elements drawn with shadcn parts, shared by every chat surface that renders agent text: tables, rules,
 * task-list boxes, quotes and the code frame. Plain text styles (paragraphs, lists, headings) stay with the surface.
 */
export const chatMarkdownComponents: Components = {
  ...chatCodeComponents,
  table: ({ children }) => <CopyableTable>{children}</CopyableTable>,
  thead: ({ children }) => <TableHeader className="bg-fill">{children}</TableHeader>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow className="border-line">{children}</TableRow>,
  th: ({ children, style }) => (
    <TableHead className="h-9 px-3 text-control font-semibold" style={style}>
      {children}
    </TableHead>
  ),
  td: ({ children, style }) => (
    <TableCell className="px-3 py-2 align-top whitespace-normal" style={style}>
      {children}
    </TableCell>
  ),
  hr: () => <Separator className="my-4 h-px" />,
  blockquote: ({ children }) => (
    <blockquote className="mx-0 my-3 border-l-2 border-border pl-4 text-muted-foreground [&>p]:my-0">
      {children}
    </blockquote>
  ),
  input: ({ type, checked, className }) =>
    type === 'checkbox' ? (
      <Checkbox
        checked={!!checked}
        disabled
        className={cn(
          'size-3.5 shrink-0 data-checked:border-muted-foreground! data-checked:bg-muted-foreground! data-checked:text-canvas! dark:data-checked:bg-muted-foreground!',
          className,
        )}
      />
    ) : (
      <input type={type} checked={checked} disabled className={className} />
    ),
  ul: ({ children, className }) => (
    <ul
      className={cn(
        className?.includes('contains-task-list')
          ? 'list-none pl-0! [&_li]:flex [&_li]:items-center [&_li]:gap-2'
          : 'list-disc pl-5',
      )}
    >
      {children}
    </ul>
  ),
}
