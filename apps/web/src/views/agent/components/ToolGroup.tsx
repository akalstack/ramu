import { t as translate, useLanguage } from '../../../i18n'
import { AgentContentView } from '../../../chat/AgentContentView'
import { toolKind, KIND_VERB } from '@ramu/shared/chat/agentTools'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/desktop-button'
import { ChevronRight } from 'lucide-react'
import { describeRamuTool, ramuTool } from '@ramu/shared/chat/ramuTools'
import { toolIsRunning, toolVerb } from '@ramu/shared/chat/toolStatus'
import { type ToolResult, type ToolUse } from '../types'
import { describeTools, toolFallbackTitle } from '../lib/toolSummary'
import { useScrollFade } from '../hooks/useScrollFade'
import { ShadowPre } from './ShadowPre'
import { WorkingText } from './WorkingText'
import { ToolIcon } from './ToolIcon'
import { RamuToolBody } from './RamuToolBody'
import {
  CARET_CLASS,
  GHOST_TEXT_BUTTON_CLASS,
  TOOL_CARD_CLASS,
  TOOL_DISCLOSURE_PANEL_CLASS,
  TOOL_ICON_CLASS,
  TOOL_SUMMARY_CLASS,
} from '../styles'

const TOOL_VERB: Record<string, string> = {
  Bash: 'Ran',
  Edit: 'Edited',
  MultiEdit: 'Edited',
  Write: 'Wrote',
  NotebookEdit: 'Edited',
  Read: 'Read',
  Grep: 'Searched',
  Glob: 'Listed',
  WebFetch: 'Fetched',
  WebSearch: 'Searched',
}

/** A run of consecutive tool calls as one collapsible row; open it for each call and its output. */
export function ToolGroup({
  tools,
  results,
  cwd,
  active,
  activity,
  onBackground,
  taskId,
}: {
  tools: ToolUse[]
  results: Map<string, ToolResult>
  cwd: string
  active: boolean
  activity?: string
  taskId?: string
  onBackground?: (toolUseId: string) => void
}) {
  useLanguage()
  const bodyRef = useScrollFade<HTMLDivElement>()
  const running = tools.some((t) => toolIsRunning(results.get(t.toolUseId), active))
  const primaryTool = tools.find((t) => toolIsRunning(results.get(t.toolUseId), active)) ?? tools[0]!
  return (
    <Collapsible defaultOpen={tools.length === 1} className="tool-group text-sm text-muted-foreground">
      {tools.length > 1 && (
        <CollapsibleTrigger
          render={
            <Button variant="ghost" className="h-auto w-full justify-start gap-2 px-2 py-1 text-sm font-normal" />
          }
        >
          <ToolIcon
            tool={primaryTool}
            content={results.get(primaryTool.toolUseId)?.content}
            className={running ? `${TOOL_ICON_CLASS} running` : TOOL_ICON_CLASS}
          />
          <span className="tool-group-label">
            {activity ? (
              <WorkingText>{running ? describeTools(tools, results, active) : activity}</WorkingText>
            ) : (
              describeTools(tools, results, active)
            )}
          </span>
          <ChevronRight size={13} className={CARET_CLASS} />
        </CollapsibleTrigger>
      )}
      <CollapsibleContent className={TOOL_DISCLOSURE_PANEL_CLASS}>
        <div
          ref={bodyRef}
          className="tool-group-body [&.fade-scroll]:max-h-[320px] [&.fade-scroll]:overflow-x-hidden [&.fade-scroll_>_*]:flex-none [&_.tool]:min-w-0 [&_.tool_>_[data-slot='collapsible-trigger']]:flex [&_.tool_>_[data-slot='collapsible-trigger']]:w-full [&_.tool_>_[data-slot='collapsible-trigger']]:max-w-full [&_.tool_>_[data-slot='collapsible-trigger']]:min-w-0 [&_.tool_>_[data-slot='collapsible-trigger']]:h-auto [&_.tool_>_[data-slot='collapsible-trigger']]:justify-start [&_.tool_>_[data-slot='collapsible-trigger']]:[border:0] [&_.tool_>_[data-slot='collapsible-trigger']]:bg-transparent [&_.tool_>_[data-slot='collapsible-trigger']]:[box-shadow:none] [&_.tool_>_[data-slot='collapsible-trigger']]:whitespace-nowrap [&_.tool_>_[data-slot='collapsible-trigger']:hover]:flex [&_.tool_>_[data-slot='collapsible-trigger']:hover]:w-full [&_.tool_>_[data-slot='collapsible-trigger']:hover]:max-w-full [&_.tool_>_[data-slot='collapsible-trigger']:hover]:min-w-0 [&_.tool_>_[data-slot='collapsible-trigger']:hover]:h-auto [&_.tool_>_[data-slot='collapsible-trigger']:hover]:justify-start [&_.tool_>_[data-slot='collapsible-trigger']:hover]:[border:0] [&_.tool_>_[data-slot='collapsible-trigger']:hover]:bg-transparent [&_.tool_>_[data-slot='collapsible-trigger']:hover]:[box-shadow:none] [&_.tool_>_[data-slot='collapsible-trigger']:hover]:whitespace-nowrap [&_.tool-summary]:flex-initial [&_.tool-summary]:min-w-0 [&_.tool-summary]:overflow-hidden [&_.tool-summary]:text-ellipsis [&_.tool-summary]:whitespace-nowrap [&_.tool_>_[data-slot='collapsible-trigger']_>_.tool-icon]:flex-none [&_.tool_>_[data-slot='collapsible-trigger']_>_.caret]:flex-none pl-3 [border-left:1px_solid_var(--line-strong)] flex flex-col m-[2px_0_0] p-0 [border:0] bg-transparent gap-0 [border-radius:0] fade-scroll [--fade-top:0px] [--fade-bottom:0px] [mask-image:linear-gradient(to_bottom,_transparent_0,_#000_var(--fade-top),_#000_calc(100%_-_var(--fade-bottom)),_transparent_100%)] [transition:--fade-top_0.14s_ease-out,_--fade-bottom_0.14s_ease-out] overflow-y-auto"
        >
          {tools.map((t) => {
            const r = results.get(t.toolUseId)
            const toolRunning = toolIsRunning(r, active)
            const summary = t.summary.split(`${cwd}/`).join('')
            const category = toolKind(t)
            const bash = category === 'execute'
            const call = ramuTool(t)
            const row = call ? describeRamuTool(call, r?.summary) : undefined
            const humanTitle = row
              ? `${translate(toolRunning ? row.running : row.done)}${row.subject ? ` ${row.subject}` : ''}`
              : (t.title?.trim() ?? toolFallbackTitle(t, toolRunning) ?? undefined)
            const inputText = t.input ?? (humanTitle === summary ? undefined : summary)
            const failed = r ? r.isError || r.status === 'failed' : t.status === 'failed'
            const state = failed
              ? 'Failed'
              : t.status === 'pending' && active
                ? 'Pending'
                : toolRunning
                  ? 'Running'
                  : !r || r.running
                    ? 'Stopped'
                    : 'Completed'
            // Threads recorded before tool references were read keep a placeholder for them; it says nothing.
            const shown = (r?.content ?? t.content)?.filter(
              (item) => !(item.type === 'unsupported' && item.label === 'Unsupported content: tool_reference'),
            )
            const movable = !!onBackground && t.name === 'Bash' && toolRunning
            return (
              <Collapsible
                key={t.toolUseId}
                data-tool-use-id={t.toolUseId}
                className="tool [&_[data-slot='collapsible-trigger']]:flex [&_[data-slot='collapsible-trigger']]:items-center [&_[data-slot='collapsible-trigger']]:cursor-pointer [&_[data-slot='collapsible-trigger']]:[list-style:none] [&_[data-slot='collapsible-trigger']]:min-w-0 [&_[data-slot='collapsible-trigger']]:m-0 [&_[data-slot='collapsible-trigger']]:p-[4px_6px] [&_[data-slot='collapsible-trigger']]:rounded-(--radius-s) [&_[data-slot='collapsible-trigger']]:gap-2 [&_[data-slot='collapsible-trigger']::-webkit-details-marker]:hidden [&_[data-slot='collapsible-trigger']:hover]:bg-hover [&_.caret]:text-muted-foreground [&_.caret]:flex-none [&_.caret]:[transition:transform_0.15s_var(--ease)] [&[data-open]_.caret]:[transform:rotate(90deg)] [&_>_[data-slot='collapsible-trigger']_.caret]:m-0 [&_>_[data-slot='collapsible-trigger']_.caret]:opacity-0 [&_>_[data-slot='collapsible-trigger']_.caret]:[transition:opacity_0.15s_var(--ease),_transform_0.15s_var(--ease)] [&_>_[data-slot='collapsible-trigger']]:m-0 [&_>_[data-slot='collapsible-trigger']]:p-[3px_0] [&_>_[data-slot='collapsible-trigger']]:[border-radius:0] [&_>_[data-slot='collapsible-trigger']]:gap-2 [&_>_[data-slot='collapsible-trigger']]:text-muted-foreground [&_>_[data-slot='collapsible-trigger']]:text-chat [&_>_[data-slot='collapsible-trigger']:hover]:bg-transparent [&_>_[data-slot='collapsible-trigger']:hover]:text-soft text-control text-soft rounded-(--radius-s)"
              >
                <CollapsibleTrigger render={<Button variant="ghost" />}>
                  <ToolIcon
                    tool={t}
                    content={r?.content ?? t.content}
                    className={`tool-icon flex-none ${failed ? 'text-bad' : 'text-muted-foreground'}${toolRunning ? ' running text-brand motion-safe:[animation:pulse_1.6s_ease-in-out_infinite]' : ''}`}
                  />
                  <span className={TOOL_SUMMARY_CLASS}>
                    {humanTitle ??
                      `${translate(toolVerb(TOOL_VERB[t.name] ?? KIND_VERB[category], toolRunning))} ${summary}`}
                  </span>
                  {(state === 'Failed' || state === 'Pending' || state === 'Stopped') && (
                    <span
                      className={`tool-state text-caption flex-none ${state === 'Failed' ? 'text-bad' : 'text-muted-foreground'}`}
                    >
                      {translate(state)}
                    </span>
                  )}
                  <ChevronRight size={12} className={CARET_CLASS} />
                </CollapsibleTrigger>
                <CollapsibleContent className={TOOL_DISCLOSURE_PANEL_CLASS}>
                  <div className={TOOL_CARD_CLASS}>
                    {!row && movable && (
                      <div className="flex justify-end px-3 pt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className={GHOST_TEXT_BUTTON_CLASS}
                          title={translate('Let the agent carry on while this keeps running')}
                          onClick={() => onBackground(t.toolUseId)}
                        >
                          {translate('Run in background')}
                        </Button>
                      </div>
                    )}
                    {row ? (
                      <RamuToolBody row={row} tool={t} result={r} />
                    ) : (
                      <>
                        {inputText && (
                          <div className="tool-input p-[8px_12px] space-y-1">
                            <span className="text-caption font-medium text-muted-foreground">{translate('Input')}</span>
                            <pre className="m-0 whitespace-pre-wrap break-words max-h-48 overflow-auto font-mono text-caption text-soft">
                              {t.input ?? (bash ? `$ ${inputText}` : inputText)}
                            </pre>
                          </div>
                        )}
                        {shown?.length ? (
                          <div className="tool-rich-content p-[8px_12px]">
                            <AgentContentView content={shown} taskId={taskId} plainText={bash} />
                          </div>
                        ) : (
                          <ShadowPre>
                            {r
                              ? r.summary || translate('No output')
                              : toolRunning
                                ? translate('Running…')
                                : translate('No output')}
                          </ShadowPre>
                        )}
                        {t.locations?.length ? (
                          <div className="tool-locations px-3 pb-2 text-caption text-muted-foreground">
                            {t.locations.map((location, i) => (
                              <div key={i}>
                                {location.path}
                                {location.line !== undefined ? `:${location.line}` : ''}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
