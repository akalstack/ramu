import { t, useLanguage } from './i18n'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Search, X } from 'lucide-react'
import { forwardRef, type ComponentProps } from 'react'

/** Shared search field with a magnifier and optional clear action. */
export const SearchInput = forwardRef<HTMLInputElement, ComponentProps<typeof InputGroupInput> & { onClear?: () => void }>(function SearchInput({ onClear, className = '', value, ...props }, ref) {
  return <InputGroup className={`search-input [&_>_[data-slot='input-group-addon']]:flex-none [&_>_[data-slot='input-group-addon']]:p-[0_8px] [&_>_[data-slot='input-group-addon']]:text-muted-foreground [&_>_input]:w-full [&_>_input]:min-w-0 [&_>_input]:h-[30px] [&_>_input]:min-h-[30px] [&_>_input]:p-0 [&_>_input]:bg-transparent [&_>_input]:[border:0] [&_>_input]:[border-radius:0] [&_>_input]:text-control [&_>_input]:leading-[20px] [&_>_input]:[box-shadow:none] [&_>_[data-align='inline-end']]:p-[0_4px] [&_.search-clear]:w-6 [&_.search-clear]:h-6 [&_.search-clear]:min-h-0 [&_.search-clear]:p-0 [&_.search-clear]:justify-center [&_.search-clear]:bg-transparent [&_.search-clear]:[border:0] [&_.search-clear]:rounded-(--radius-s) [&_.search-clear]:text-muted-foreground [&_.search-clear:hover:not(:disabled)]:bg-hover [&_.search-clear:hover:not(:disabled)]:text-foreground [&_.search-clear:hover:not(:disabled)]:[border:0] [.chat-switch-search_&_>_input]:h-[30px] [.chat-switch-search_&_>_input]:min-h-[30px] [&_[data-slot='input-group-addon']_>_svg]:w-3.5 [&_[data-slot='input-group-addon']_>_svg]:h-3.5 [&_>_input:focus-visible]:outline-none [&:focus-within]:[border-color:color-mix(in_srgb,_var(--text)_26%,_transparent)] [&:focus-within]:[box-shadow:none] flex items-center w-full min-w-0 h-8 min-h-8 [background:var(--field)] [border:1px_solid_transparent] rounded-(--radius-s) ${className}`}>
    <InputGroupAddon><Search size={14} aria-hidden="true" /></InputGroupAddon>
    <InputGroupInput ref={ref} value={value} {...props} />
    {onClear && value ? <InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" className="search-clear" aria-label={t("Clear search")} onClick={onClear}><X size={13} /></InputGroupButton></InputGroupAddon> : null}
  </InputGroup>
})
