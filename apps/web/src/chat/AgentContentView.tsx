import { chatCodeComponents } from './ChatCodeBlock'
import { ChatLink } from './ChatReferences'
import { parseThreadReference, remarkChatReferences, SKILL_REFERENCE_PREFIX } from '@ramu/shared/chat/chatReferences'
import { localFileLink } from '@ramu/shared/workspace/fileLinks'
import { useEffect, useMemo, useRef, useState } from 'react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileText, Image as ImageIcon, SquareTerminal } from 'lucide-react'
import type { AgentContent } from '@ramu/shared/types'
import { agentContent, inlineMedia, resourceDownload } from '@ramu/shared/chat/agentContent'
import { ChatImage, ChatMarkdownImage, useChatImage } from './ChatImage'
import { monaco } from '../editor/monaco'
import { t, useLanguage } from '../i18n'
import { editorThemeName } from '../editor/editorTheme'

function ContentLink({ uri, label, taskId }: { uri: string; label: string; taskId?: string }) {
  if (/^https?:\/\//i.test(uri))
    return (
      <a className="text-brand break-all" href={uri} target="_blank" rel="noreferrer">
        {label}
      </a>
    )
  if (!taskId || !localFileLink(uri)) return <span className="break-all">{label}</span>
  return (
    <ChatLink href={uri} taskId={taskId}>
      {label}
    </ChatLink>
  )
}

function AgentImage({ content, taskId }: { content: Extract<AgentContent, { type: 'image' }>; taskId?: string }) {
  const inline = useMemo(() => {
    const normalized = agentContent(content)[0]
    return normalized?.type === 'image' ? inlineMedia(normalized.mimeType, normalized.data, 'image') : undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [content.mimeType, content.data, content.uri] by design; the values it reads beyond these are current as of that run
  }, [content.mimeType, content.data, content.uri])
  const src = useChatImage(inline ?? content.uri, taskId)
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return (
    <figure className="agent-image m-0 space-y-2">
      {src && !failed ? (
        <ChatImage src={src} alt={content.alt ?? t('Agent image')} onError={() => setFailed(true)} />
      ) : (
        <div className="flex items-center gap-2 p-3 bg-fill rounded-(--radius-s) text-muted-foreground">
          <ImageIcon size={16} />
          <span>{t('Image preview unavailable')}</span>
        </div>
      )}
      {content.uri && (
        <figcaption className="text-caption text-muted-foreground">
          <ContentLink uri={content.uri} label={content.alt ?? content.uri} taskId={taskId} />
        </figcaption>
      )}
    </figure>
  )
}

function AgentDiff({ content, taskId }: { content: Extract<AgentContent, { type: 'diff' }>; taskId?: string }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const original = monaco.editor.createModel(
      content.oldText ?? '',
      undefined,
      monaco.Uri.from({ scheme: 'inmemory', path: `/${crypto.randomUUID()}/${content.path}` }),
    )
    const modified = monaco.editor.createModel(content.newText, original.getLanguageId())
    const editor = monaco.editor.createDiffEditor(host.current!, {
      theme: editorThemeName(),
      readOnly: true,
      automaticLayout: true,
      renderSideBySide: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 12,
      lineNumbersMinChars: 3,
      scrollbar: { alwaysConsumeMouseWheel: false },
    })
    editor.setModel({ original, modified })
    return () => {
      editor.dispose()
      original.dispose()
      modified.dispose()
    }
  }, [content.path, content.oldText, content.newText])
  const lines = Math.max(content.newText.split('\n').length, (content.oldText ?? '').split('\n').length)
  return (
    <div className="agent-content-diff space-y-2">
      <ContentLink uri={content.path} label={content.path} taskId={taskId} />
      <div
        ref={host}
        style={{ height: Math.min(320, Math.max(100, (lines + 2) * 20)) }}
        className="overflow-hidden rounded-(--radius-s)"
      />
    </div>
  )
}

export function AgentContentView({
  content,
  taskId,
  plainText = false,
}: {
  content: AgentContent[]
  taskId?: string
  plainText?: boolean
}) {
  useLanguage()
  return (
    <div className="agent-content flex flex-col gap-3 min-w-0 text-control text-soft">
      {content.map((item, index) => (
        <div key={index} data-content-type={item.type}>
          {item.type === 'text' ? (
            <div className="agent-content-text whitespace-pre-wrap break-words [&_p]:m-0 [&_pre]:overflow-auto [&_pre]:p-2 [&_pre]:bg-fill [&_pre]:rounded-(--radius-s) [&_a]:text-brand">
              {plainText ? (
                <pre className="m-0 font-mono whitespace-pre-wrap break-words max-h-64 overflow-auto text-caption">
                  {item.text}
                </pre>
              ) : (
                <Markdown
                  remarkPlugins={[remarkGfm, remarkChatReferences]}
                  urlTransform={(url) =>
                    url.startsWith(SKILL_REFERENCE_PREFIX) || parseThreadReference(url) || localFileLink(url)
                      ? url
                      : defaultUrlTransform(url)
                  }
                  components={{
                    ...chatCodeComponents,
                    a: ({ href, children }) => (
                      <ChatLink href={href} taskId={taskId}>
                        {children}
                      </ChatLink>
                    ),
                    img: ({ src, alt }) => (
                      <ChatMarkdownImage src={typeof src === 'string' ? src : undefined} alt={alt} taskId={taskId} />
                    ),
                  }}
                >
                  {item.text}
                </Markdown>
              )}
            </div>
          ) : item.type === 'image' ? (
            <AgentImage content={item} taskId={taskId} />
          ) : item.type === 'audio' ? (
            inlineMedia(item.mimeType, item.data, 'audio') ? (
              <audio
                controls
                preload="none"
                src={inlineMedia(item.mimeType, item.data, 'audio')}
                className="max-w-full h-10"
                aria-label={t('Agent audio')}
              />
            ) : (
              <span>{t('Audio preview unavailable')}</span>
            )
          ) : item.type === 'diff' ? (
            <AgentDiff content={item} taskId={taskId} />
          ) : item.type === 'terminal' ? (
            <div className="space-y-2">
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <SquareTerminal size={14} />
                {t('Terminal')} {item.terminalId}
              </span>
              <pre className="m-0 whitespace-pre-wrap break-words font-mono">
                {item.output ?? t('The provider sent a terminal reference with no output.')}
              </pre>
            </div>
          ) : item.type === 'resource' ? (
            <div className="agent-resource rounded-(--radius-s) bg-fill p-3 space-y-2">
              <span className="flex items-center gap-2">
                <FileText size={14} />
                <ContentLink uri={item.uri} label={item.name} taskId={taskId} />
              </span>
              {item.description && <p className="m-0 text-muted-foreground">{item.description}</p>}
              {item.text !== undefined && (
                <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-caption">
                  {item.text}
                </pre>
              )}
              {resourceDownload(item.blob) && (
                <a
                  href={resourceDownload(item.blob)}
                  download={item.name.split('/').at(-1)}
                  className="inline-block text-brand text-caption"
                >
                  {t('Download resource')}
                </a>
              )}
              {item.blob && item.mimeType?.startsWith('image/') ? (
                <AgentImage
                  content={{ type: 'image', mimeType: item.mimeType, data: item.blob, alt: item.name }}
                  taskId={taskId}
                />
              ) : item.blob ? (
                <span className="text-muted-foreground text-caption">
                  {item.mimeType ?? t('Binary resource')} · {Math.ceil((item.blob.length * 3) / 4 / 1024)} KB
                </span>
              ) : null}
            </div>
          ) : (
            <div className="rounded-(--radius-s) bg-fill p-3 text-muted-foreground">
              {item.label}
              {item.detail && <span className="block text-caption">{item.detail}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
