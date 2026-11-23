import type { ComponentProps, Ref } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from 'cn'
import type { ProseDensity } from '@ramu/shared/prose'
import { chatMarkdownComponents } from './ChatMarkdown'

/**
 * The reading frame (`prose.css`) for a block of Markdown or other long-form text. Spread it on the element that holds
 * text that is not drawn by `MarkdownText`, such as a hand-drawn diff.
 */
export function proseProps(density: ProseDensity = 'reply', className?: string) {
  return { className: cn('ramu-prose', className), 'data-density': density }
}

/**
 * Markdown as every surface in the app reads it: GitHub-flavoured, its tables, code, quotes and task lists drawn with the
 * shared parts, in the shared reading scale. A surface changes what it must (links, images, plugins) and picks a
 * density; its size or colour can be set with a utility on `className`.
 */
export function MarkdownText({
  children,
  density = 'reply',
  className,
  components,
  remarkPlugins = [remarkGfm],
  ref,
  ...markdown
}: Omit<ComponentProps<typeof Markdown>, 'children'> & {
  children: string
  density?: ProseDensity
  className?: string
  ref?: Ref<HTMLDivElement>
}) {
  return (
    <div ref={ref} {...proseProps(density, className)}>
      <Markdown remarkPlugins={remarkPlugins} components={components ?? chatMarkdownComponents} {...markdown}>
        {children}
      </Markdown>
    </div>
  )
}
