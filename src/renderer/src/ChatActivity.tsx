import type { ComponentProps } from 'react'
import { Button } from '@/components/desktop-button'

/** Shared transcript action styling; uses the same quiet treatment as tool rows. */
export function ChatActivityButton({ className = '', ...props }: ComponentProps<typeof Button>) {
  return <Button {...props} variant="ghost" className={`chat-activity-row ${className}`} />
}
