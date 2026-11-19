import { Search, X } from 'lucide-react'
import { cn } from 'cn'
import { Button } from './desktop-button'
import { Input } from './desktop-input'
import { t } from '../i18n'

/** A filter field with its search mark, a clear button once it has text, and Escape to clear it. */
export function SearchField({
  value,
  onChange,
  label,
  placeholder = label,
  className,
  inputClassName,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  className?: string
  inputClassName?: string
}) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <Search
        size={13}
        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            // Clears the field first; a second Escape reaches whatever owns the view.
            event.stopPropagation()
            onChange('')
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        className={cn('pl-7', value && 'pr-7', inputClassName)}
      />
      {value && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="absolute right-1 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
          aria-label={t('Clear search')}
          title={t('Clear search')}
          onClick={() => onChange('')}
        >
          <X size={12} />
        </Button>
      )}
    </div>
  )
}
