import { useSettingsField } from '../settings/settingsField'
import type { ComponentProps } from 'react'
import { cn } from 'cn'
import { Button as NativeButton } from '@/components/ui/button'

/** Teach the class merger that Ramu's semantic text aliases are font sizes, not text colors. */
function textSizes(className: string) {
  return className.replace(/\S+/g, (token) =>
    token.replace(/(^|:)text-(caption|control|body|chat|heading|hero)$/, '$1text-[length:var(--font-$2)]'),
  )
}

/** Keep desktop density and the user's font size while composing the registry Button. */
export function Button({ className, size, variant = 'secondary', ...props }: ComponentProps<typeof NativeButton>) {
  const field = useSettingsField()
  return (
    <NativeButton
      variant={variant}
      size={size}
      className={cn(
        'text-[length:var(--font-body)] font-normal whitespace-inherit disabled:opacity-40',
        size?.startsWith('icon') ? 'min-h-0' : 'h-auto min-h-[26px]',
        variant === 'secondary' && 'bg-fill hover:bg-fill-hover',
        typeof className === 'string' ? textSizes(className) : className,
      )}
      {...props}
      disabled={props.disabled || field?.disabled}
    />
  )
}
