/** Tailwind class strings shared by the agent view's components. Keep each one whole so Tailwind can still find its tokens. */

export { GHOST_TEXT_BUTTON_CLASS, GHOST_ICON_BUTTON_CLASS as ICON_BUTTON_CLASS } from '@/components/button-classes'

/** A row in the queued-messages list. */
export const QUEUED_MESSAGE_CLASS =
  'queued-message [&_>_span]:flex-1 [&_>_span]:min-w-0 [&_>_span]:whitespace-pre-wrap [&_>_span]:[overflow-wrap:anywhere] [&_button]:flex-none [&_.queued-text]:flex-1 [&_.queued-text]:min-w-0 [&_.queued-text]:whitespace-nowrap [&_.queued-text]:overflow-hidden [&_.queued-text]:text-ellipsis [&_.queued-text]:text-foreground flex items-center text-control gap-2 min-h-8'

/** The "Working" status line. */
export const WORKING_CLASS =
  'working [&_.shimmer]:text-chat [&_.shimmer]:leading-[inherit] text-chat leading-[inherit] p-[4px_0] min-h-6 flex items-center'

/** Disclosure caret that rotates when its collapsible is open. */
export const CARET_CLASS =
  "caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot='collapsible-trigger']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot='collapsible-trigger']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]"

/** Leading icon of a tool row. */
export const TOOL_ICON_CLASS = 'tool-icon flex-none text-muted-foreground'

/** One-line summary text of a tool row. */
export const TOOL_SUMMARY_CLASS =
  'tool-summary overflow-hidden text-ellipsis whitespace-nowrap min-w-0 font-sans text-chat text-inherit flex-initial'

/** Collapsible panel that animates to its content height. */
export const TOOL_DISCLOSURE_PANEL_CLASS =
  'tool-disclosure-panel [&[data-starting-style]]:h-0 [&[data-ending-style]]:h-0 [&[data-starting-style]]:opacity-0 [&[data-ending-style]]:opacity-0 h-[var(--collapsible-panel-height)] overflow-hidden motion-safe:[transition:height_200ms_var(--ease),opacity_160ms_var(--ease)]'

/** Bordered card holding a tool call body. */
export const TOOL_CARD_CLASS =
  'tool-card [&_.tool-output]:m-0 [&_.tool-output]:[border:0] [&_.tool-output]:[border-radius:0] [&_.tool-output]:bg-transparent [&_.tool-output]:p-[8px_12px_10px] [&_.tool-output]:max-h-[260px] [&_.tool-output]:text-caption [&_.tool-output]:whitespace-pre-wrap [&_.tool-output]:[overflow-wrap:anywhere] [&_.tool-output]:text-muted-foreground m-[6px_0_8px] [border:1px_solid_transparent] rounded-(--radius-m) [background:rgb(var(--ink)_/_0.035)] overflow-hidden'

/** The user's bubble (a shadcn Bubble `secondary` supplies the fill); `msg user` keeps selection and quoting working. */
export const USER_BUBBLE_CLASS =
  'msg user whitespace-pre-wrap rounded-[calc(var(--radius-l)_-_2px)] rounded-br-(--radius-xs) bg-(--bubble)! px-3.5 py-2.5 text-chat leading-[1.55] tracking-[-0.006em] text-(--text-body)!'

/** Message bubble base: add `user`, `assistant` or `error text-bad`. */
export const MSG_CLASS =
  'msg [&.user]:self-end [&.user]:whitespace-pre-wrap [&.user]:max-w-[78%] [&.user]:mt-[18px] [&.user]:w-[fit-content] [&.user]:[background:var(--bubble)] [&.user]:[border:0] [&.user]:[box-shadow:none] [&.user]:text-chat [&.user]:leading-[1.55] [&.user]:p-[10px_16px_11px] [&.user]:rounded-(--radius-l) [&.user]:tracking-[-0.006em] [&.user]:[color:var(--text-body)] [&.assistant]:relative [&.assistant]:tracking-[-0.008em] [&.assistant]:text-chat [&.assistant]:leading-[1.62] [&.assistant]:[color:var(--text-body)] [&.assistant_>_:first-child]:mt-0 [&.assistant_>_:last-child]:mb-0 [&.assistant_p]:m-[0_0_12px] [&.assistant_ul]:pl-5 [&.assistant_ul]:m-[0_0_12px] [&.assistant_ol]:pl-5 [&.assistant_ol]:m-[0_0_12px] [&.assistant_:not(pre)>code]:[background:rgb(var(--ink)_/_0.06)] [&.assistant_:not(pre)>code]:[border:0] [&.assistant_:not(pre)>code]:rounded-(--radius-xs) [&.assistant_:not(pre)>code]:p-[1px_4px] [&.assistant_:not(pre)>code]:[color:var(--text-body)] [&.assistant_:not(pre)>code]:text-[length:0.84em] [&.assistant_:not(pre)>code]:tracking-normal [&.assistant_:not(pre)>code]:[box-decoration-break:clone] [&.assistant_:not(pre)>code]:[overflow-wrap:break-word] [&.assistant_a]:text-brand [&.assistant_a]:[text-decoration:none] [&.meta]:text-caption [&.meta]:text-muted-foreground [&.error]:text-bad [&.assistant:hover_.msg-actions]:opacity-100 [&.user_.muted.small.block]:mt-0.5 [&.user_.muted.small.block]:[color:rgb(var(--ink)_/_0.7)] [&.assistant_li]:m-[4px_0] [&.assistant_li>p]:mb-1 [&.assistant_li::marker]:text-muted-foreground [&.assistant_strong]:font-semibold [&.assistant_strong]:[color:var(--text)] [&.assistant_h1]:text-[length:1em] [&.assistant_h1]:font-semibold [&.assistant_h1]:m-[20px_0_6px] [&.assistant_h1]:tracking-[-0.012em] [&.assistant_h2]:text-[length:1em] [&.assistant_h2]:font-semibold [&.assistant_h2]:m-[20px_0_6px] [&.assistant_h2]:tracking-[-0.012em] [&.assistant_h3]:text-[length:1em] [&.assistant_h3]:font-semibold [&.assistant_h3]:m-[20px_0_6px] [&.assistant_h3]:tracking-[-0.012em] [&.assistant_a:hover]:[text-decoration:underline] [.msg-wrap.user_&.user]:max-w-full [.msg-wrap.user_&.user]:mt-3.5 [&.assistant_.msg-actions]:mt-2 [&.assistant_:is(h1,_h2,_h3,_h4,_strong)]:text-foreground [&.assistant_>_:is(p,_ul,_ol,_h1,_h2,_h3,_h4,_blockquote)]:max-w-[72ch] break-words'

/** A horizontal rule with a centred label. */
export const CONVERSATION_SEPARATOR_CLASS =
  "conversation-separator [&::before]:[content:''] [&::before]:h-px [&::before]:flex-1 [&::before]:min-w-4 [&::before]:[background:var(--line)] [&::after]:[content:''] [&::after]:h-px [&::after]:flex-1 [&::after]:min-w-4 [&::after]:[background:var(--line)] [&_small]:block [&_small]:text-muted-foreground [&_small]:text-caption [&_small]:mt-[3px] flex items-center gap-3 m-[20px_0] text-caption text-center text-muted-foreground"

/** Header row of the sub-agent and aside panels. */
export const PANEL_HEADER_CLASS =
  'agent-panel-header [&_>_.small-icon]:flex-none flex items-center gap-1.5 min-h-10 p-[4px_8px_4px_12px] flex-none pr-2 [border-bottom:0]'

/** Title text in a panel header. */
export const PANEL_TITLE_CLASS =
  'agent-panel-title [.aside-panel_&]:flex-none min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold'

/** Small section label inside a panel. */
export const PANEL_LABEL_CLASS =
  'agent-panel-label block mb-1 text-muted-foreground text-caption font-semibold tracking-[0.02em] [text-transform:uppercase]'

/** Scrolling body of a panel. */
export const PANEL_BODY_CLASS =
  'agent-panel-body [&_.msg-wrap.user]:self-end [&_.msg-wrap.user]:max-w-[90%] [&_.msg-wrap.user_.msg.user]:mt-0 [&_>_*]:min-w-0 [&_>_*]:max-w-full [&_>_*]:flex-none [&_>_*]:[overflow-wrap:anywhere] flex-1 min-h-0 overflow-auto scroll-fade-y flex flex-col gap-2.5 p-[14px_14px_28px]'

/** A half of the selection split button. */
export const SELECTION_ACTION_CLASS =
  'bg-fill hover:bg-fill-hover selection-action [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:0] [&_svg]:text-soft h-[26px] min-h-[26px] gap-1.5 p-[0_10px] [border:0] rounded-full bg-transparent text-foreground text-control whitespace-nowrap'

/** Quote line inside an aside row. */
export const ASIDE_ROW_QUOTE_CLASS =
  'aside-row-quote font-semibold overflow-hidden text-ellipsis whitespace-nowrap max-w-full'

/** A quiet line at the end of a turn; add `error text-bad` for a failure. */
export const TURN_END_CLASS =
  'turn-end [&_svg]:text-ok [&_svg]:flex-none [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:p-0.5 [&_svg]:rounded-full [&_svg]:[background:var(--ok-wash)] [&.error_svg]:text-bad [&.error_svg]:[background:var(--bad-wash)] [&.chat-note]:m-[8px_0] [&.chat-note_svg]:text-muted-foreground [&_.muted]:ml-auto [&_.muted]:tabular-nums [&.error]:[border-top:none] [&.error]:text-bad flex items-center text-caption text-muted-foreground gap-2 p-[6px_0_2px] [border-top:1px_solid_var(--line)] mt-1'
