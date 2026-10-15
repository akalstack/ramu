import { useSettingsField } from '../../settingsField'
import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import { cn } from 'cn'

function Switch({
  className,
  size = 'default',
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: 'sm' | 'default'
}) {
  const field = useSettingsField()
  const onCheckedChange: typeof props.onCheckedChange = (...args) => {
    field?.mark()
    props.onCheckedChange?.(...args)
  }
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        'peer group/switch relative inline-block shrink-0 rounded-full border border-transparent p-0 outline-none bg-[var(--pressed)] focus-visible:outline-2 focus-visible:outline-[var(--line-strong)] focus-visible:outline-offset-2 aria-invalid:border-destructive data-[size=default]:h-5 data-[size=default]:w-[34px] data-[size=sm]:h-4 data-[size=sm]:w-[26px] data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
      {...props}
      disabled={props.disabled || field?.disabled}
      onCheckedChange={onCheckedChange}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none absolute left-0.5 top-0.5 m-0 shrink-0 rounded-full bg-white translate-x-0 transition-transform duration-120 group-data-[size=default]/switch:size-3.5 group-data-[size=sm]/switch:size-2.5 group-data-[size=default]/switch:data-checked:translate-x-3.5 group-data-[size=sm]/switch:data-checked:translate-x-2.5"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
