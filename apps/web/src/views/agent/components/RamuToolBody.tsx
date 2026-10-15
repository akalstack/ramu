import { t as translate, useLanguage } from '../../../i18n'
import { describeRamuTool } from '@ramu/shared/chat/ramuTools'
import { ramu } from '../../../ipc'
import { type ToolResult, type ToolUse } from '../types'

/** A Ramu tool opens to the few facts that matter. The raw request and response stay a click away. */
export function RamuToolBody({
  row,
  tool,
  result,
}: {
  row: ReturnType<typeof describeRamuTool>
  tool: ToolUse
  result: ToolResult | undefined
}) {
  useLanguage()
  const output = result?.summary?.trim()
  const failed = !!result && (result.isError || result.status === 'failed')
  const shell = row.icon === 'terminal'
  return (
    <div className="tool-ramu p-[8px_12px] space-y-2">
      {row.facts.length > 0 && (
        <dl className="m-0 space-y-1 text-caption">
          {row.facts.map((fact) => (
            <div key={fact.label} className="flex gap-3">
              <dt className="flex-none w-16 text-muted-foreground">{translate(fact.label)}</dt>
              <dd className="m-0 min-w-0 max-h-24 overflow-auto whitespace-pre-wrap break-words text-soft">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {failed && output && <p className="m-0 text-caption text-bad whitespace-pre-wrap break-words">{output}</p>}
      {shell && !failed && output && (
        <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-caption text-muted-foreground">
          {output}
        </pre>
      )}
      {!shell && (tool.input || output) && (
        <details className="tool-raw text-caption text-muted-foreground">
          <summary className="w-fit cursor-pointer select-none hover:text-soft">{translate('Details')}</summary>
          <pre className="m-0 mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-muted-foreground">
            {[tool.input, output].filter(Boolean).join('\n\n')}
          </pre>
        </details>
      )}
    </div>
  )
}
