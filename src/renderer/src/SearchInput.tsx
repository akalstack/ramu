import { t, useLanguage } from './i18n'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Search, X } from 'lucide-react'
import { forwardRef, type ComponentProps } from 'react'

/** Shared search field with a magnifier and optional clear action. */
export const SearchInput = forwardRef<HTMLInputElement, ComponentProps<typeof InputGroupInput> & { onClear?: () => void }>(function SearchInput({ onClear, className = '', value, ...props }, ref) {
  // Like the find bar's field: a soft filled pill with no border and no focus ring, so nothing nests or shifts.
  return <InputGroup className={`search-input h-8! rounded-(--radius-s)! border-0! bg-fill! shadow-none! ring-0! has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot=input-group-control]:focus-visible]:border-0 *:data-[slot=input-group-addon]:pl-2.5! ${className}`}>
    <InputGroupAddon><Search className="size-4 shrink-0 opacity-50" aria-hidden="true" /></InputGroupAddon>
    <InputGroupInput ref={ref} value={value} className="w-full min-w-0 text-sm outline-hidden" {...props} />
    {onClear && value ? <InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" className="search-clear size-6" aria-label={t("Clear search")} onClick={onClear}><X size={13} /></InputGroupButton></InputGroupAddon> : null}
  </InputGroup>
})
