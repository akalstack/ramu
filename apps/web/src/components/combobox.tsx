import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { ChevronDown } from 'lucide-react'
import { cn } from 'cn'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { t, useLanguage } from '../i18n'
import { useSettingsField } from '../settings/settingsField'
import { filterComboboxOptions, type ComboboxOption } from './combobox-options'

export type { ComboboxOption }

// cmdk falls back to an item's text when its value is empty, so every item carries a prefix.
const itemValue = (value: string) => `option:${value}`

/**
 * A Dropdown you type into, for any list long enough to search: models, branches, repositories. Every word typed
 * narrows it, in any order; options can carry an icon, a second line and a group, whose heading stays in view while
 * its options scroll. A very long list draws its first rows and asks for a narrower search.
 */
export function Combobox({
  label,
  value,
  options,
  onChange,
  icon,
  placeholder = t('Select…'),
  searchPlaceholder = t('Search…'),
  emptyText = t('No matches'),
  className = '',
  disabled = false,
  title,
  bare = false,
}: {
  label: string
  value: string
  options: readonly ComboboxOption[]
  onChange: (value: string) => void
  /** Shown before the trigger's text; the chosen option's own icon otherwise. */
  icon?: ReactNode
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  disabled?: boolean
  title?: string
  /** Skip the field-style trigger so `className` supplies the whole look, e.g. a composer chip. */
  bare?: boolean
}) {
  useLanguage()
  const field = useSettingsField()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)
  const { groups, hidden } = useMemo(
    () => filterComboboxOptions(options, query, { keep: value }),
    [options, query, value],
  )
  // Opening lands on the chosen option, scrolled into view below its sticky group heading.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() =>
      list.current?.querySelector('[data-checked="true"]')?.scrollIntoView({ block: 'center' }),
    )
    return () => cancelAnimationFrame(frame)
  }, [open])
  const change = (next: boolean) => {
    setOpen(next)
    if (!next) setQuery('')
  }
  const pick = (next: string) => {
    change(false)
    field?.mark()
    onChange(next)
  }
  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger
        disabled={disabled || !!field?.disabled || !options.length}
        aria-label={label}
        aria-haspopup="listbox"
        title={title ?? selected?.title ?? (selected?.detail ? `${selected.label} · ${selected.detail}` : undefined)}
        className={
          bare
            ? `flex items-center min-w-0 disabled:opacity-50 [&_>_svg]:flex-none [&_>_svg:last-child]:size-3 [&_>_svg:last-child]:ml-auto [&_>_svg:last-child]:text-muted-foreground ${className}`
            : `dropdown-trigger [&_>_svg]:flex-none [&_>_svg]:w-3.5 [&_>_svg]:h-3.5 [&_>_svg]:text-soft [&_>_svg:last-child]:w-3 [&_>_svg:last-child]:h-3 [&_>_svg:last-child]:ml-auto [&_>_svg:last-child]:text-muted-foreground [&:hover]:bg-hover [&[aria-expanded=true]]:bg-hover flex items-center gap-2 min-h-[30px] min-w-0 p-[5px_10px] [border:1px_solid_transparent] rounded-(--radius-s) text-[length:var(--ui-font-size)] leading-[18px] text-left bg-fill disabled:opacity-50 ${className}`
        }
      >
        {icon ?? (selected?.icon && <span className="flex flex-none items-center">{selected.icon}</span>)}
        <span className={`min-w-0 flex-1 truncate${bare ? ' chip-label' : ''}`}>
          {selected?.label ?? (value || placeholder)}
        </span>
        <ChevronDown />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--anchor-width) min-w-64 max-w-[min(26rem,calc(100vw-16px))] gap-0 p-0"
      >
        <Command className="p-0" label={label} shouldFilter={false} loop defaultValue={itemValue(value)}>
          <CommandInput placeholder={searchPlaceholder} value={query} onValueChange={setQuery} />
          <CommandList ref={list} className="max-h-80 px-1 pb-1">
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groups.map((group) =>
              group.name === null ? (
                <div key="" className="pt-1">
                  {group.options.map((option) => (
                    <Row key={option.value} option={option} chosen={option.value === value} pick={pick} />
                  ))}
                </div>
              ) : (
                <CommandPrimitive.Group
                  key={group.name}
                  heading={group.name}
                  className="[&_[cmdk-group-heading]]:sticky [&_[cmdk-group-heading]]:top-0 [&_[cmdk-group-heading]]:z-1 [&_[cmdk-group-heading]]:truncate [&_[cmdk-group-heading]]:bg-popover [&_[cmdk-group-heading]]:px-1.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                >
                  {group.options.map((option) => (
                    <Row key={option.value} option={option} chosen={option.value === value} pick={pick} />
                  ))}
                </CommandPrimitive.Group>
              ),
            )}
            {hidden > 0 && (
              <p className="m-0 px-2 py-1.5 text-caption text-muted-foreground" role="status">
                {t('{0} more. Type to narrow the list.', { '0': hidden })}
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function Row({ option, chosen, pick }: { option: ComboboxOption; chosen: boolean; pick: (value: string) => void }) {
  return (
    <CommandItem
      value={itemValue(option.value)}
      disabled={option.disabled}
      data-checked={chosen}
      title={option.title}
      className={cn(
        'gap-2 rounded-md px-1.5 py-1 text-sm data-selected:bg-accent data-selected:text-accent-foreground',
        chosen && 'font-medium',
      )}
      onSelect={() => pick(option.value)}
    >
      {option.icon && <span className="flex flex-none items-center">{option.icon}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{option.label}</span>
        {option.detail && <span className="truncate text-caption text-muted-foreground">{option.detail}</span>}
      </span>
    </CommandItem>
  )
}
