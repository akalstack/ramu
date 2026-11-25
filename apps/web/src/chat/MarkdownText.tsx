import { memo, useMemo, type ComponentProps, type Ref } from 'react'
import Markdown from 'react-markdown'
import { markdownBlocks } from '@ramu/shared/chat/markdownBlocks'
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
  streaming,
  ref,
  ...markdown
}: Omit<ComponentProps<typeof Markdown>, 'children'> & {
  children: string
  density?: ProseDensity
  className?: string
  /**
   * Text that arrives over time (a reply, a thought). Set, it is drawn a top-level block at a time so a new token parses
   * only the block it lands in; while true, each block fades in once as it appears (`prose.css`).
   */
  streaming?: boolean
  ref?: Ref<HTMLDivElement>
}) {
  const blocks = useMemo(() => (streaming === undefined ? null : markdownBlocks(children)), [children, streaming])
  const shared = { remarkPlugins, components: components ?? chatMarkdownComponents, ...markdown }
  return (
    <div ref={ref} {...proseProps(density, className)} data-streaming={streaming ? '' : undefined}>
      {blocks ? (
        blocks.map((block, index) => (
          <MarkdownBlock key={index} {...shared}>
            {block}
          </MarkdownBlock>
        ))
      ) : (
        <Markdown {...shared}>{children}</Markdown>
      )}
    </div>
  )
}

/**
 * One block of streaming Markdown, parsed again only when its own text or its components change. Plugins and the URL
 * transform are left out of the comparison: callers rebuild those inline on every render without changing them.
 */
const MarkdownBlock = memo(
  function MarkdownBlock(props: ComponentProps<typeof Markdown> & { children: string }) {
    return <Markdown {...props} />
  },
  (before, after) =>
    before.children === after.children &&
    before.components === after.components &&
    before.rehypePlugins === after.rehypePlugins,
)
