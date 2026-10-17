import type { Components } from 'react-markdown'
import { cn } from 'cn'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { chatCodeComponents } from './ChatCodeBlock'

/**
 * Markdown elements drawn with shadcn parts, shared by every chat surface that renders agent text: tables, rules,
 * task-list boxes, quotes and the code frame. Plain text styles (paragraphs, lists, headings) stay with the surface.
 */
export const chatMarkdownComponents: Components = {
  ...chatCodeComponents,
  table: ({ children }) => (
    <div className="my-3 w-fit max-w-full overflow-hidden rounded-lg border border-line bg-card/50">
      <Table className="w-auto border-collapse border-spacing-0 text-control">{children}</Table>
    </div>
  ),
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
