import { t, useLanguage } from './i18n'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Search, X } from 'lucide-react'
import { forwardRef, type ComponentProps, type ReactNode } from 'react'
import { cn } from 'cn'

/**
 * Shared search field. The input and its fixed-size addons share one surface.
 * `actions` adds controls at the end, such as option toggles.
 */
export const SearchInput = forwardRef<
  HTMLInputElement,
  ComponentProps<'input'> & { onClear?: () => void; actions?: ReactNode }
>(function SearchInput({ onClear, actions, className, value, ...props }, ref) {
  useLanguage()
  return (
    <InputGroup
      className={cn(
        'search-input h-8! shrink-0 gap-2 rounded-lg! border-input/30 bg-input/30 shadow-none! focus-within:border-input/30! focus-within:ring-0!',
        className,
      )}
    >
      <InputGroupInput
        ref={ref}
        value={value}
        className="rounded-none! border-0! bg-transparent! py-0! pr-2! pl-0! shadow-none! focus-visible:outline-none!"
        {...props}
      />
      <InputGroupAddon className="shrink-0">
        <Search className="size-4 shrink-0 opacity-50" aria-hidden="true" />
      </InputGroupAddon>
      {actions || (onClear && value) ? (
        <InputGroupAddon align="inline-end" className="search-actions shrink-0 gap-1 m-0! py-0! pr-1! pl-0!">
          {actions}
          {onClear && value ? (
            <InputGroupButton
              size="icon-xs"
              className="search-clear size-6 rounded-md! bg-transparent! text-muted-foreground hover:bg-hover! hover:text-foreground"
              aria-label={t('Clear search')}
              disabled={props.disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onClear}
            >
              <X size={13} />
            </InputGroupButton>
          ) : null}
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  )
})
