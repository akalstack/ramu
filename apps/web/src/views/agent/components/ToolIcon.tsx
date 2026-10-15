import { toolKind } from '@ramu/shared/chat/agentTools'
import {
  Wrench,
  Globe,
  FilePenLine,
  FileMinus2,
  ArrowRightLeft,
  Settings2,
  Image as ImageIcon,
  Brain,
  BookOpen,
  Search,
  SquareTerminal,
  CalendarClock,
  MessageSquareText,
  ListChecks,
  Sparkles,
} from 'lucide-react'
import { describeRamuTool, ramuTool, type RamuToolIcon } from '@ramu/shared/chat/ramuTools'
import { ramu } from '../../../ipc'
import { type ToolResult, type ToolUse } from '../types'

const RAMU_ICONS: Record<RamuToolIcon, typeof Wrench> = {
  brain: Brain,
  book: BookOpen,
  search: Search,
  sparkles: Sparkles,
  calendar: CalendarClock,
  message: MessageSquareText,
  review: ListChecks,
  terminal: SquareTerminal,
  wrench: Wrench,
}

/** The icon for a tool call, by tool kind or Ramu tool. */
export function ToolIcon({
  tool,
  content,
  className,
}: {
  tool: ToolUse
  content?: ToolResult['content']
  className?: string
}) {
  const kind = toolKind(tool)
  const ramu = ramuTool(tool)
  const Icon = ramu
    ? RAMU_ICONS[describeRamuTool(ramu).icon]
    : content?.some((c) => c.type === 'image') || /image/i.test(tool.name)
      ? ImageIcon
      : {
          read: BookOpen,
          edit: FilePenLine,
          delete: FileMinus2,
          move: ArrowRightLeft,
          search: Search,
          execute: SquareTerminal,
          think: Brain,
          fetch: Globe,
          switch_mode: Settings2,
          other: Wrench,
        }[kind]
  return <Icon size={14} className={className} aria-hidden="true" />
}
