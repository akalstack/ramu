import type { ComponentProps } from 'react'
import { cn } from 'cn'
import { buttonVariants } from '@/components/ui/button'

/** The site's two button looks, laid over the registry Button: filled purple, or a quiet translucent fill. */
const TONES = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
  quiet: 'bg-fill text-foreground hover:bg-fill-hover',
} as const

type Tone = keyof typeof TONES

/** A call to action that navigates, styled as a button. */
export function LinkButton({ tone = 'quiet', className, ...props }: ComponentProps<'a'> & { tone?: Tone }) {
  return (
    <a
      className={cn(
        buttonVariants(),
        'h-[38px] rounded-[var(--radius-row)] px-4 text-[14px] font-[560] no-underline',
        TONES[tone],
        className,
      )}
      {...props}
    />
  )
}
