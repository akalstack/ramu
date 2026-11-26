import { toolActivity } from '@ramu/shared/chat/toolActivity'
import { ActivityText } from '../../../chat/ActivityText'
import { useChatFade } from '../../../chat/ChatMotion'
import { useState } from 'react'
import { t as translate, useLanguage } from '../../../i18n'
import { isViewImageTool, readImageContent, toolImageName } from '../lib/toolImage'
import { splitToolContent } from '../lib/toolContent'
import { AgentContentView } from '../../../chat/AgentContentView'
import { toolKind, KIND_VERB } from '@ramu/shared/chat/agentTools'
import { fileToolDiffs, fileToolLine } from '@ramu/shared/chat/fileTools'
import { FileToolCounts } from './FileToolCounts'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/desktop-button'
import { Brain, ChevronRight, CircleX } from 'lucide-react'
import { toolFailure } from '@ramu/shared/chat/toolFailure'
import { thoughtBlock, thoughtEnding, thoughtLine } from '@ramu/shared/chat/thoughtLine'
import { describeRamuTool, ramuTool } from '@ramu/shared/chat/ramuTools'
import { toolIsRunning, toolVerb } from '@ramu/shared/chat/toolStatus'
import { type ToolResult, type ToolUse } from '../types'
import { describeTools, toolFallbackTitle } from '../lib/toolSummary'
import { useScrollFade } from '../hooks/useScrollFade'
import { useHeldHeight } from '../hooks/useHeldHeight'
import { ShadowPre } from './ShadowPre'
import { ToolIcon } from './ToolIcon'
import { ThinkingRow } from './ThinkingRow'
import type { ToolEntry } from '../lib/toolThinking'
import { RamuToolBody } from './RamuToolBody'
import {
  CARET_CLASS,
  GHOST_TEXT_BUTTON_CLASS,
  TOOL_CARD_CLASS,
  TOOL_DISCLOSURE_PANEL_CLASS,
  TOOL_ICON_CLASS,
  TOOL_SUMMARY_CLASS,
} from '../styles'

const shownHasDiff = (content: ToolUse['content']) => Boolean(content?.some((item) => item.type === 'diff'))

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

const failedResult = (tool: ToolUse, result: ToolResult | undefined) =>
  result ? result.isError || result.status === 'failed' : tool.status === 'failed'

/**
 * The words of one call's row, which the live group's headline also shows: Ramu's own tools what they did, file tools
 * the verb and file name, a titled call its title, and any other call its verb and what it acted on.
 */
function toolRow(t: ToolUse, r: ToolResult | undefined, cwd: string, active: boolean) {
  const toolRunning = toolIsRunning(r, active)
  const summary = t.summary.split(`${cwd}/`).join('')
  const call = ramuTool(t)
  const row = call ? describeRamuTool(call, r?.summary) : undefined
  const { images: sent, details } = splitToolContent(r?.content ?? t.content)
  const imageTitle = sent.length || isViewImageTool(t.name) ? toolImageName(t) : undefined
  // Reads, edits and writes name just the file (and an edit its +/- lines) until the row is opened.
  const file = row || imageTitle ? null : fileToolLine(t, r)
  const fileTitle = file
    ? `${translate(toolVerb(file.verb, toolRunning))} ${file.name}${file.others ? ` ${translate('+{count} more', { count: file.others })}` : ''}`
    : undefined
  const humanTitle =
    fileTitle ??
    imageTitle ??
    (row
      ? `${translate(toolRunning ? row.running : row.done)}${row.subject ? ` ${row.subject}` : ''}`
      : ((t.title?.trim() || toolFallbackTitle(t, toolRunning)) ?? undefined))
  const line =
    humanTitle ?? `${translate(toolVerb(TOOL_VERB[t.name] ?? KIND_VERB[toolKind(t)], toolRunning))} ${summary}`
  return { toolRunning, summary, row, sent, details, file, imageTitle, humanTitle, line }
}

/**
 * What a failed call said, under its row while the row is closed. A command keeps its exit code and last output lines
 * in monospace; any other tool says its error once, in plain words. Opening the row shows the whole output instead.
 */
function ToolFailureLines({ output, shell }: { output: string | undefined; shell: boolean }) {
  const { exit, lines } = toolFailure(output)
  if (!lines.length && exit === undefined) return null
  if (!shell)
    return (
      <div
        className="tool-failure mb-1 ml-[22px] min-w-0 truncate text-caption text-muted-foreground"
        title={lines.at(-1)}
      >
        {lines.at(-1)}
      </div>
    )
  return (
    <div className="tool-failure mb-1 ml-[22px] min-w-0 border-l-2 border-bad/40 pl-2 font-mono text-caption leading-[1.5] text-soft">
      {exit !== undefined && <div className="text-bad">{translate('Exit code {0}', { 0: exit })}</div>}
      {lines.map((line, index) => (
        <div key={index} className="truncate" title={line}>
          {line}
        </div>
      ))}
    </div>
  )
}

/**
 * A run of consecutive tool calls as one collapsible row; open it for each call and its output. While it is the live
 * group of a running turn its headline names the newest call, so what the agent is doing now reads in place.
 */
export function ToolGroup({
  tools,
  entries = tools,
  results,
  cwd,
  active,
  live = false,
  onBackground,
  taskId,
  bare = false,
}: {
  /**
   * A lone call shown open with no row of its own, for a pane that already names it (a background command's own pane):
   * its command and output, not a folded line repeating the pane's title.
   */
  bare?: boolean
  tools: ToolUse[]
  entries?: ToolEntry[]
  results: Map<string, ToolResult>
  cwd: string
  active: boolean
  live?: boolean
  taskId?: string
  onBackground?: (toolUseId: string) => void
}) {
  useLanguage()
  const [open, setOpen] = useState(false)
  const bodyRef = useScrollFade<HTMLDivElement>()
  // Only the folded live row holds its height: that is where lines come and go as calls start and finish. Opened, the
  // group reads as the person left it.
  const held = useHeldHeight<HTMLDivElement>(live && active && !open, tools[0]?.toolUseId)
  const status = toolActivity(tools, (tool) => {
    const result = results.get(tool.toolUseId)
    return failedResult(tool, result) || tool.status === 'failed'
      ? 'failed'
      : toolIsRunning(result, active)
        ? 'running'
        : 'done'
  })
  const running = status.running > 0
  const primaryTool = status.current ?? (live ? tools.at(-1)! : tools[0]!)
  // The live group's newest step may be a thought, so its headline reads what the agent is considering now.
  const latest = entries.at(-1)
  const thought = live && !running && latest?.kind === 'thinking' ? latest : undefined
  // Until the live group settles, its latest thought stays under the headline, between calls too, instead of hiding in
  // the closed group the moment a call finishes.
  const lastThought = live && !thought ? entries.findLast((entry) => entry.kind === 'thinking') : undefined
  const lastFailed = tools.findLast((tool) => failedResult(tool, results.get(tool.toolUseId)))
  const lastFailedLine = lastFailed ? toolFailure(results.get(lastFailed.toolUseId)?.summary).lines.at(-1) : undefined
  const headline = thought
    ? thoughtLine(thought.text, true) || translate('Thinking')
    : running || live
      ? // The call itself, as its row reads ("Running pnpm test"), never a count of one.
        primaryTool.title?.trim() || toolRow(primaryTool, results.get(primaryTool.toolUseId), cwd, active).line
      : describeTools(tools, results, active, cwd)
  // Only a new paragraph of thought fades in. The next call, or the summary once the group settles, takes the line's
  // place at once, as in T3 Code: a fade on every call made a busy turn flicker.
  const newestThought = entries.findLastIndex((entry) => entry.kind === 'thinking')
  const newestThoughtEntry = entries[newestThought]
  const headlineFade = useChatFade<HTMLSpanElement>(
    newestThoughtEntry?.kind === 'thinking' ? `thought:${newestThought}:${thoughtBlock(newestThoughtEntry.text)}` : '',
  )
  const thoughtFade = useChatFade<HTMLSpanElement>(lastThought ? String(thoughtBlock(lastThought.text)) : '')
  return (
    // Any click inside is the person opening or folding something, which the hold must let show.
    <div ref={held.ref} onClickCapture={held.release}>
      {/* Keyed by whether it is a group, so a lone row becoming one switches at once instead of animating shut. */}
      <Collapsible
        key={entries.length > 1 ? 'group' : 'single'}
        open={entries.length === 1 || open}
        onOpenChange={setOpen}
        className="tool-group text-sm text-muted-foreground"
      >
        {entries.length > 1 && (
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                className="h-auto w-full justify-start gap-2 px-0 py-1 text-sm font-normal hover:bg-transparent hover:text-soft"
              />
            }
          >
            {thought ? (
              <Brain size={14} className={TOOL_ICON_CLASS} />
            ) : (
              <ToolIcon
                tool={primaryTool}
                content={results.get(primaryTool.toolUseId)?.content}
                className={TOOL_ICON_CLASS}
              />
            )}
            <span ref={headlineFade} className="flex min-w-0">
              <ActivityText active={running || live} className="tool-group-label truncate text-left">
                {headline}
              </ActivityText>
            </span>
            {status.failed > 0 && (
              // A quiet mark, as in T3 Code: the tinted icon and this cross say it failed; the words stay the tool's own.
              <span
                className="flex flex-none items-center gap-0.5 text-caption text-bad"
                aria-label={status.failed > 1 ? translate('{0} failed', { 0: status.failed }) : translate('Failed')}
              >
                <CircleX size={13} aria-hidden="true" />
                {status.failed > 1 && status.failed}
              </span>
            )}
            <ChevronRight size={13} className={CARET_CLASS} />
          </CollapsibleTrigger>
        )}
        {entries.length > 1 && !open && !running && lastFailed && (
          // A closed group names its latest failure and what it said, so a failed step is never hidden behind "Ran 5 commands".
          <div className="ml-[22px] min-w-0 truncate pb-1 text-caption text-muted-foreground">
            {toolRow(lastFailed, results.get(lastFailed.toolUseId), cwd, active).line}
            {lastFailedLine ? `: ${lastFailedLine}` : null}
          </div>
        )}
        {entries.length > 1 && !open && lastThought && thoughtEnding(lastThought.text) && (
          <div className="flex min-w-0 items-start gap-2 pb-1 text-caption text-muted-foreground">
            <Brain size={12} className="mt-[3px] flex-none opacity-70" />
            <span ref={thoughtFade} className="line-clamp-3 min-w-0">
              {thoughtEnding(lastThought.text)}
            </span>
          </div>
        )}
        <CollapsibleContent className={TOOL_DISCLOSURE_PANEL_CLASS}>
          <div
            ref={bodyRef}
            className={`tool-group-body [&.fade-scroll]:max-h-[320px] [&.fade-scroll]:overflow-x-hidden [&.fade-scroll_>_*]:flex-none [&_.tool]:min-w-0 [&_.tool_>_[data-slot='collapsible-trigger']]:flex [&_.tool_>_[data-slot='collapsible-trigger']]:w-full [&_.tool_>_[data-slot='collapsible-trigger']]:max-w-full [&_.tool_>_[data-slot='collapsible-trigger']]:min-w-0 [&_.tool_>_[data-slot='collapsible-trigger']]:h-auto [&_.tool_>_[data-slot='collapsible-trigger']]:justify-start [&_.tool_>_[data-slot='collapsible-trigger']]:[border:0] [&_.tool_>_[data-slot='collapsible-trigger']]:bg-transparent [&_.tool_>_[data-slot='collapsible-trigger']]:[box-shadow:none] [&_.tool_>_[data-slot='collapsible-trigger']]:whitespace-nowrap [&_.tool_>_[data-slot='collapsible-trigger']:hover]:flex [&_.tool_>_[data-slot='collapsible-trigger']:hover]:w-full [&_.tool_>_[data-slot='collapsible-trigger']:hover]:max-w-full [&_.tool_>_[data-slot='collapsible-trigger']:hover]:min-w-0 [&_.tool_>_[data-slot='collapsible-trigger']:hover]:h-auto [&_.tool_>_[data-slot='collapsible-trigger']:hover]:justify-start [&_.tool_>_[data-slot='collapsible-trigger']:hover]:[border:0] [&_.tool_>_[data-slot='collapsible-trigger']:hover]:bg-transparent [&_.tool_>_[data-slot='collapsible-trigger']:hover]:[box-shadow:none] [&_.tool_>_[data-slot='collapsible-trigger']:hover]:whitespace-nowrap [&_.tool-summary]:flex-initial [&_.tool-summary]:min-w-0 [&_.tool-summary]:overflow-hidden [&_.tool-summary]:text-ellipsis [&_.tool-summary]:whitespace-nowrap [&_.tool_>_[data-slot='collapsible-trigger']_>_.tool-icon]:flex-none [&_.tool_>_[data-slot='collapsible-trigger']_>_.caret]:flex-none flex flex-col m-[2px_0_0] p-0 [border:0] bg-transparent gap-0 [border-radius:0] fade-scroll [--fade-top:0px] [--fade-bottom:0px] [mask-image:linear-gradient(to_bottom,_transparent_0,_#000_var(--fade-top),_#000_calc(100%_-_var(--fade-bottom)),_transparent_100%)] [transition:--fade-top_0.14s_ease-out,_--fade-bottom_0.14s_ease-out] overflow-y-auto`}
          >
            {entries.map((t, index) => {
              if (t.kind === 'thinking')
                return <ThinkingRow key={`thinking-${index}`} text={t.text} active={t === thought} />
              const r = results.get(t.toolUseId)
              const { toolRunning, summary, row, sent, details, file, imageTitle, humanTitle, line } = toolRow(
                t,
                r,
                cwd,
                active,
              )
              const bash = toolKind(t) === 'execute'
              const readImage = file?.verb === 'Read' && !sent.length ? readImageContent(file.path) : undefined
              const images = readImage ? [readImage] : sent
              const inputText = t.input ?? (humanTitle === summary ? undefined : summary)
              // An opened edit shows its change as a diff, built from the input when the provider sent none.
              const builtDiffs = file && !shownHasDiff(r?.content ?? t.content) ? fileToolDiffs(t, r) : []
              const failed = failedResult(t, r)
              const state = failed
                ? 'Failed'
                : t.status === 'pending' && active
                  ? 'Pending'
                  : toolRunning
                    ? 'Running'
                    : !r || r.running
                      ? 'Stopped'
                      : 'Completed'
              const movable = !!onBackground && t.name === 'Bash' && toolRunning
              return (
                <Collapsible
                  key={t.toolUseId}
                  data-tool-use-id={t.toolUseId}
                  {...(bare && entries.length === 1 ? { open: true } : {})}
                  className="tool [&[data-open]_>_.tool-failure]:hidden [&_[data-slot='collapsible-trigger']]:flex [&_[data-slot='collapsible-trigger']]:items-center [&_[data-slot='collapsible-trigger']]:cursor-pointer [&_[data-slot='collapsible-trigger']]:[list-style:none] [&_[data-slot='collapsible-trigger']]:min-w-0 [&_[data-slot='collapsible-trigger']]:m-0 [&_[data-slot='collapsible-trigger']]:p-[4px_6px] [&_[data-slot='collapsible-trigger']]:rounded-(--radius-s) [&_[data-slot='collapsible-trigger']]:gap-2 [&_[data-slot='collapsible-trigger']::-webkit-details-marker]:hidden [&_[data-slot='collapsible-trigger']:hover]:bg-hover [&_.caret]:text-muted-foreground [&_.caret]:flex-none [&_.caret]:[transition:transform_0.15s_var(--ease)] [&[data-open]_.caret]:[transform:rotate(90deg)] [&_>_[data-slot='collapsible-trigger']_.caret]:m-0 [&_>_[data-slot='collapsible-trigger']_.caret]:opacity-0 [&_>_[data-slot='collapsible-trigger']_.caret]:[transition:opacity_0.15s_var(--ease),_transform_0.15s_var(--ease)] [&_>_[data-slot='collapsible-trigger']]:m-0 [&_>_[data-slot='collapsible-trigger']]:p-[3px_0] [&_>_[data-slot='collapsible-trigger']]:[border-radius:0] [&_>_[data-slot='collapsible-trigger']]:gap-2 [&_>_[data-slot='collapsible-trigger']]:text-muted-foreground [&_>_[data-slot='collapsible-trigger']]:text-chat [&_>_[data-slot='collapsible-trigger']:hover]:bg-transparent [&_>_[data-slot='collapsible-trigger']:hover]:text-soft text-control text-soft rounded-(--radius-s)"
                >
                  <CollapsibleTrigger render={<Button variant="ghost" />} hidden={bare && entries.length === 1}>
                    <ToolIcon
                      tool={t}
                      content={r?.content ?? t.content}
                      className={`tool-icon flex-none ${failed ? 'text-bad' : 'text-muted-foreground'}`}
                    />
                    <ActivityText active={toolRunning} className={TOOL_SUMMARY_CLASS}>
                      {line}
                    </ActivityText>
                    {file && <FileToolCounts added={file.added} removed={file.removed} />}
                    {state === 'Failed' && (
                      <CircleX size={13} className="tool-state flex-none text-bad" aria-label={translate('Failed')} />
                    )}
                    {(state === 'Pending' || state === 'Stopped') && (
                      <span className="tool-state text-caption flex-none text-muted-foreground">
                        {translate(state)}
                      </span>
                    )}
                    <ChevronRight size={12} className={CARET_CLASS} />
                  </CollapsibleTrigger>
                  {failed && !toolRunning && !row && <ToolFailureLines output={r?.summary} shell={bash} />}
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
                          {builtDiffs.length > 0 && (
                            <div className="tool-rich-content p-[8px_12px]">
                              <AgentContentView content={builtDiffs} taskId={taskId} />
                            </div>
                          )}
                          {inputText && !imageTitle && !builtDiffs.length && (
                            <div className="tool-input p-[8px_12px] space-y-1">
                              <span className="text-caption font-medium text-muted-foreground">
                                {translate('Input')}
                              </span>
                              <pre className="m-0 whitespace-pre-wrap break-words max-h-48 overflow-auto font-mono text-caption text-soft">
                                {t.input ?? (bash ? `$ ${inputText}` : inputText)}
                              </pre>
                            </div>
                          )}
                          {details?.length ? (
                            <div className="tool-rich-content p-[8px_12px]">
                              <AgentContentView content={details} taskId={taskId} plainText={bash} />
                            </div>
                          ) : !images.length ? (
                            <ShadowPre>
                              {r
                                ? r.summary || translate('No output')
                                : toolRunning
                                  ? translate('Running…')
                                  : translate('No output')}
                            </ShadowPre>
                          ) : null}
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
                      {images.length > 0 && (
                        <div className="tool-images p-3" data-tool-image-id={t.toolUseId}>
                          <AgentContentView content={images} taskId={taskId} />
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
