import { t } from '../../i18n'
import { useSettingsField } from '../../settingsField'
import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  const field = useSettingsField()
  const mixed = field?.mixed && field.schema?.type === 'string'
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
      disabled={props.disabled || field?.disabled}
      maxLength={field?.schema?.maxLength === undefined ? props.maxLength : Math.min(props.maxLength ?? Infinity, field.schema.maxLength)}
      value={mixed ? '' : props.value}
      placeholder={mixed ? t('Mixed') : props.placeholder}
      onChange={(event) => { field?.mark(); props.onChange?.(event) }}
    />
  )
}

export { Textarea }
