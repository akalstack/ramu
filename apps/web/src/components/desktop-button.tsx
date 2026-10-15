import { useSettingsField } from '../settingsField'
import type { ComponentProps } from 'react'
import { cn } from 'cn'
import { Button as NativeButton } from '@/components/ui/button'

/** Keep desktop density and the user's font size while composing the registry Button. */
export function Button({ className, size, variant = 'secondary', ...props }: ComponentProps<typeof NativeButton>) {
  const field = useSettingsField()
  return (
    <NativeButton
      variant={variant}
      size={size}
      className={cn(
        'text-body font-normal whitespace-inherit disabled:opacity-40',
        size?.startsWith('icon') ? 'min-h-0' : 'h-auto min-h-[26px]',
        variant === 'secondary' && 'bg-fill hover:bg-fill-hover',
        className,
      )}
      {...props}
      disabled={props.disabled || field?.disabled}
    />
  )
}
