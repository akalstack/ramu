import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Search, X } from 'lucide-react'
import { forwardRef, type ComponentProps } from 'react'

/** Shared search field with a magnifier and optional clear action. */
export const SearchInput = forwardRef<HTMLInputElement, ComponentProps<typeof InputGroupInput> & { onClear?: () => void }>(function SearchInput({ onClear, className = '', value, ...props }, ref) {
  return <InputGroup className={`search-input ${className}`}>
    <InputGroupAddon><Search size={14} aria-hidden="true" /></InputGroupAddon>
    <InputGroupInput ref={ref} value={value} {...props} />
    {onClear && value ? <InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" className="search-clear" aria-label="Clear search" onClick={onClear}><X size={13} /></InputGroupButton></InputGroupAddon> : null}
  </InputGroup>
})
