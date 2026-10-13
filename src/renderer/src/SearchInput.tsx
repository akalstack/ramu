import { t, useLanguage } from './i18n'
import { InputGroup, InputGroupAddon, InputGroupButton } from '@/components/ui/input-group'
import { Search, X } from 'lucide-react'
import { forwardRef, type ComponentProps, type ReactNode } from 'react'
import { cn } from 'cn'

/**
 * Shared search field, built like the ⌘P palette's CommandInput: a plain input inside an InputGroup, so there is no
 * purple focus ring and nothing nests. `actions` adds controls at the end, such as option toggles.
 */
export const SearchInput = forwardRef<HTMLInputElement, ComponentProps<'input'> & { onClear?: () => void; actions?: ReactNode }>(function SearchInput({ onClear, actions, className, value, ...props }, ref) {
  useLanguage()
  return <InputGroup className={cn('search-input h-8! rounded-lg! border-input/30 bg-input/30 shadow-none! *:data-[slot=input-group-addon]:pl-2!', className)}>
    <input ref={ref} data-slot="command-input" value={value} className="w-full min-w-0 flex-1 rounded-none! border-0! bg-transparent! py-0! pr-2! pl-1! text-sm shadow-none! outline-none! focus-visible:outline-none! disabled:cursor-not-allowed disabled:opacity-50" {...props} />
    <InputGroupAddon><Search className="size-4 shrink-0 opacity-50" aria-hidden="true" /></InputGroupAddon>
    {actions ? <InputGroupAddon align="inline-end" role="group" className="search-actions gap-px">{actions}</InputGroupAddon> : null}
    {onClear && value ? <InputGroupAddon align="inline-end" className="pr-1.5!"><InputGroupButton size="icon-xs" className="search-clear size-6 rounded-md! bg-transparent! text-muted-foreground hover:bg-hover! hover:text-foreground" aria-label={t("Clear search")} onClick={onClear}><X size={13} /></InputGroupButton></InputGroupAddon> : null}
  </InputGroup>
})
