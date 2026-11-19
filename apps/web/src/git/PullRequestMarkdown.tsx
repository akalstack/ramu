import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from 'cn'
import { forgeCommentMarkdown } from '@ramu/shared/forgeMarkdown'
import { previewRehypePlugins } from '@ramu/shared/workspace/markdownRendering'
import { chatMarkdownComponents } from '../chat/ChatMarkdown'
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
export function PullRequestMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        'min-w-0 text-control text-soft [overflow-wrap:anywhere] [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-2.5 [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1.5 [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:pl-5 [&_li]:my-0.5 [&_h1]:my-2 [&_h1]:text-body [&_h1]:font-semibold [&_h2]:my-2 [&_h2]:text-body [&_h2]:font-semibold [&_h3]:my-1.5 [&_h3]:text-control [&_h3]:font-semibold [&_img]:max-w-full',
        className,
      )}
    >
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={previewRehypePlugins} components={components}>
        {forgeCommentMarkdown(children)}
      </Markdown>
    </div>
  )
}
