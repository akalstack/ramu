import type { Components } from 'react-markdown'
import { cn } from 'cn'
import type { ProseDensity } from '@ramu/shared/prose'
import { forgeCommentMarkdown } from '@ramu/shared/forgeMarkdown'
import { previewRehypePlugins } from '@ramu/shared/workspace/markdownRendering'
import { chatMarkdownComponents } from '../chat/ChatMarkdown'
import { MarkdownText } from '../chat/MarkdownText'
import { ChatCodePre } from '../chat/ChatCodeBlock'
import { t } from '../i18n'

/** A ```suggestion block, as GitHub shows it: the lines the reviewer proposes, or that they propose removing. */
function Suggestion({ source }: { source: string }) {
  const lines = source.replace(/\n$/, '')
  return (
    <figure className="my-2 overflow-hidden rounded-(--radius-s) bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]">
      <figcaption className="px-2.5 pt-1.5 text-caption text-muted-foreground">
        {lines ? t('Suggested change') : t('Suggests removing these lines')}
      </figcaption>
      {lines && (
        <pre className="m-0 overflow-x-auto bg-[color-mix(in_srgb,var(--ok)_8%,transparent)] px-2.5 py-1.5 font-mono text-caption">
          {lines.split('\n').map((line, index) => (
            <div key={index}>
              <span className="mr-2 select-none text-[var(--ok)]">+</span>
              {line}
            </div>
          ))}
        </pre>
      )}
    </figure>
  )
}

const components: Components = {
  ...chatMarkdownComponents,
  pre: (props) => {
    const code = props.node?.children.find((child) => child.type === 'element' && child.tagName === 'code')
    const classes = code?.type === 'element' ? code.properties.className : undefined
    if (code?.type === 'element' && Array.isArray(classes) && classes.map(String).includes('language-suggestion'))
      return <Suggestion source={code.children.map((child) => (child.type === 'text' ? child.value : '')).join('')} />
    return <ChatCodePre {...props} />
  },
  // A review bot folds long parts away; they stay folded here too, with a summary that reads as a control.
  details: ({ children }) => (
    <details className="my-1.5 rounded-(--radius-s) bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] px-2.5 py-1.5 [&[open]>summary]:mb-1.5">
      {children}
    </details>
  ),
  summary: ({ children }) => (
    <summary className="cursor-pointer text-caption font-medium text-muted-foreground hover:text-foreground">
      {children}
    </summary>
  ),
  // The window's content policy loads no remote images, which also keeps a comment's tracking pixels out. A remote
  // image shows as its alt text, so a bot's image button still reads as its link; one without alt text is left out.
  img: ({ src, alt }) =>
    typeof src === 'string' && /^https?:/i.test(src) ? (
      alt ? (
        <span>{alt}</span>
      ) : null
    ) : (
      <img src={src} alt={alt ?? ''} />
    ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-brand underline-offset-2 hover:underline">
      {children}
    </a>
  ),
}

/**
 * A pull request's description or comment as the hosting service shows it: GitHub-flavored Markdown with its HTML
 * sanitized, folded <details>, hidden comments left out, emoji shortcodes drawn and suggestions shown as changes.
 */
export function PullRequestMarkdown({
  children,
  density = 'compact',
  className,
}: {
  children: string
  /** A comment reads as a card; a description, which is the page's main text, as a reply. */
  density?: ProseDensity
  className?: string
}) {
  return (
    <MarkdownText
      density={density}
      className={cn('[overflow-wrap:anywhere]', className)}
      rehypePlugins={previewRehypePlugins}
      components={components}
    >
      {forgeCommentMarkdown(children)}
    </MarkdownText>
  )
}
