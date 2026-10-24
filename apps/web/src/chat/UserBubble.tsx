import type { ReactNode } from 'react'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { USER_BUBBLE_CLASS } from '../views/agent/styles'

/** The user's bubble, tinted by the shadcn `secondary` variant. */
export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <Bubble variant="secondary" align="end">
      <BubbleContent className={USER_BUBBLE_CLASS}>{children}</BubbleContent>
    </Bubble>
  )
}
