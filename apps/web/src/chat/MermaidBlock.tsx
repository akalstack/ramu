import { useEffect, useId, useState } from 'react'
import { Button } from '@/components/desktop-button'
import { copyText } from '../ipc'
import { t } from '../i18n'
import { notifyError } from './Notifications'
import { errorText } from '../lib/errors'
// The renderer is shared, lazy and serialized: Mermaid owns some module-level rendering state.
let rendering = Promise.resolve()
export function MermaidBlock({ source }: { source: string }) {
  const id = `ramu-diagram-${useId().replace(/[^a-z0-9]/gi, '')}`
  const [result, setResult] = useState<{ source: string; svg?: string; failed?: boolean } | null>(null)
  useEffect(() => {
    let cancelled = false
    rendering = rendering
      .catch(() => {})
      .then(async () => {
        if (cancelled) return
        try {
          if (source.length > 50000) throw new Error(t('Diagram too large'))
          const { default: mermaid } = await import('mermaid')
          if (cancelled) return
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering'],
            suppressErrorRendering: true,
            maxTextSize: 50000,
            maxEdges: 500,
            theme: 'dark',
            fontFamily: 'inherit',
          })
          const { svg } = await mermaid.render(id, source)
          if (!cancelled) setResult({ source, svg })
        } catch {
          if (!cancelled) setResult({ source, failed: true })
        }
      })
    return () => {
      cancelled = true
    }
  }, [source, id])
  const shown = result?.source === source ? result : null
  return (
    <div className="mermaid-block rounded-lg border border-border p-3 flex flex-col gap-2">
      <Button
        variant="ghost"
        size="sm"
        className="self-end"
        onClick={() => void copyText(source).catch((error) => notifyError(errorText(error)))}
      >
        {t('Copy diagram source')}
      </Button>
      {shown?.svg ? (
        <div
          className="overflow-auto [&_svg]:max-w-full"
          role="img"
          aria-label={t('Mermaid diagram')}
          dangerouslySetInnerHTML={{ __html: shown.svg }}
        />
      ) : (
        <>
          <p className="text-caption text-muted-foreground">
            {shown?.failed ? t('Diagram preview unavailable. The source is shown below.') : t('Rendering diagram…')}
          </p>
          <pre className="overflow-auto">
            <code>{source}</code>
          </pre>
        </>
      )}
    </div>
  )
}
