import { isViewImageTool } from '../lib/toolImage'
import { toolKind } from '@ramu/shared/chat/agentTools'
import {
  Wrench,
  Eye,
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
} from 'lucide-react'
import { ramuTool } from '@ramu/shared/chat/ramuTools'
import { RamuGlyph } from '../../../Brand'
import { type ToolResult, type ToolUse } from '../types'

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
  // Ramu's own tools wear its mark, so the agent using Ramu reads apart from the agent using the machine; the row's
  // words say which Ramu action it was.
  if (ramuTool(tool) && !isViewImageTool(tool.name)) return <RamuGlyph size={14} className={className} />
  const Icon = isViewImageTool(tool.name)
    ? Eye
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
