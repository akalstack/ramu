import type { ReactNode } from 'react'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { USER_BUBBLE_CLASS } from '../views/agent/styles'

/** The user's bubble, matching the phone: the theme's bubble color with a tight corner toward the sender. */
export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <Bubble variant="secondary" align="end" className="max-w-full">
      <BubbleContent className={USER_BUBBLE_CLASS}>{children}</BubbleContent>
    </Bubble>
  )
}
