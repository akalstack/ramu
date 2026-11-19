import { t } from '../../i18n'
import { useSettingsField } from '../../settings/settingsField'
import * as React from 'react'
import { Input as InputPrimitive } from '@base-ui/react/input'
import { cn } from 'cn'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  const field = useSettingsField()
  const mixed = field?.mixed && ['string', 'number', 'integer'].includes(field.schema?.type ?? '')
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
      disabled={props.disabled || field?.disabled}
      min={
        field?.schema?.minimum === undefined
          ? props.min
          : Math.max(Number(props.min ?? -Infinity), field.schema.minimum)
      }
      max={
        field?.schema?.maximum === undefined ? props.max : Math.min(Number(props.max ?? Infinity), field.schema.maximum)
      }
      maxLength={
        field?.schema?.maxLength === undefined
          ? props.maxLength
          : Math.min(props.maxLength ?? Infinity, field.schema.maxLength)
      }
      value={mixed ? '' : props.value}
      placeholder={mixed ? t('Mixed') : props.placeholder}
      onChange={(event) => {
        field?.mark()
        props.onChange?.(event)
      }}
    />
  )
}

export { Input }
