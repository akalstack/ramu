import { REFERENCE_APPEARANCE } from '@ramu/shared/chat/presentation'
import type { ReactNode } from 'react'
import { Folder, Quote, SquareTerminal, Users, WandSparkles } from 'lucide-react'
import type { ReferenceChip } from '@ramu/shared/chat/referenceChip'
import { localFileLink } from '@ramu/shared/workspace/fileLinks'
import { Badge } from '@/components/ui/badge'
import { FileIcon } from '../editor/FileIcon'
import { ProviderIcon } from '../models/ProviderIcon'

/** The icon of a chip: the file's own icon, a folder, or the glyph of its kind. */
export function ReferenceChipIcon({ chip }: { chip: ReferenceChip }) {
  switch (chip.kind) {
    case 'file':
      return <FileIcon path={(chip.target && localFileLink(chip.target)?.path) || chip.label} />
    case 'folder':
      return <Folder aria-hidden="true" />
    case 'skill':
      return <WandSparkles className="text-brand" aria-hidden="true" />
    case 'quote':
      return <Quote aria-hidden="true" />
    case 'command':
      return <SquareTerminal aria-hidden="true" />
    case 'mention':
      return chip.provider ? <ProviderIcon provider={chip.provider} size={14} /> : <Users aria-hidden="true" />
  }
}

/**
 * The shadcn Badge as a plain accent-colored link with its icon, no fill or ring, so it reads like text in a line.
 * Code inside drops its own bubble. The class reads the style's variables, so the two travel together, and a label at the width limit shortens without squeezing the icon; shared by the transcript and the composer's inline references.
 */
export const REFERENCE_CHIP = {
  className:
    'inline-flex h-auto min-h-0 max-w-[min(100%,var(--reference-chip-width))] items-baseline gap-(--reference-chip-gap) rounded-none border-0 bg-transparent p-0 align-baseline text-[length:inherit] leading-[inherit] font-normal whitespace-nowrap text-[color:var(--accent)]! no-underline! [&>:first-child]:flex-none [&>svg]:self-center [&>span]:min-w-0 [&>span]:border-0 [&>span]:border-b [&>span]:border-solid [&>span]:border-b-transparent [&>span]:leading-[1.15] [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[0.95em] [&:is(a,button,[role=button])]:cursor-pointer [&:is(a,button,[role=button])]:hover:bg-transparent [&:is(a,button,[role=button])]:hover:[&>span]:border-b-current [&:is(a,button,[role=button])]:focus-visible:[&>span]:border-b-current',
  style: {
    '--reference-chip-width': `${REFERENCE_APPEARANCE.maxWidth}px`,
    '--reference-chip-gap': `${REFERENCE_APPEARANCE.gap}px`,
    fontWeight: REFERENCE_APPEARANCE.fontWeight,
  } as React.CSSProperties,
}

/**
 * A reference in chat (file, folder, skill, command, quote) as a small chip that sits in the line of text without making
 * it taller. `href` and `onOpen` make it a link. What it shows comes from the shared chip
 * model, the same one the phone draws. A shadcn Attachment is too tall for running text, so this stays a Badge.
 */
export function ReferenceChipView({
  chip,
  label,
  href,
  title,
  onOpen,
}: {
  chip: ReferenceChip
  /** Replaces the chip's own label (a Markdown link keeps its author's words). */
  label?: ReactNode
  href?: string
  title?: string
  onOpen?: (event: React.MouseEvent<HTMLAnchorElement>) => void
}) {
  return (
    <Badge
      variant="secondary"
      {...REFERENCE_CHIP}
      title={title ?? chip.title}
      {...(href !== undefined ? { render: <a href={href} />, onClick: onOpen } : {})}
    >
      <ReferenceChipIcon chip={chip} />
      <span className="truncate">{label ?? chip.label}</span>
    </Badge>
  )
}
