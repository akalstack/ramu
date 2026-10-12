import type { ComponentProps } from 'react'
import { cn } from 'cn'
import { Field } from '@/components/ui/field'

/** A native Field with the compact row layout shared by desktop Settings. */
export function SettingsRow({ className, ...props }: ComponentProps<typeof Field>) {
  return <Field orientation="horizontal" className={cn(
    'settings-row',
    "[&_>_span:first-child]:min-w-0 [&_strong]:font-medium [&_.block]:mt-1 [&_.block]:leading-[18px]",
    "[&_.block]:max-w-[420px] [&_.dropdown-trigger]:min-w-[150px] [&_.dropdown-trigger]:max-w-[230px] [&_.dropdown-trigger]:flex-none",
    "[&_[data-slot='input']]:w-[230px] [&_[data-slot='input']]:flex-none [&_input:not([type='checkbox'])]:w-[230px] [&_input:not([type='checkbox'])]:flex-none",
    "[&:first-child]:[border-top-left-radius:var(--radius-m)] [&:first-child]:[border-top-right-radius:var(--radius-m)] [:not(.settings-row)_+_&]:[border-top-left-radius:var(--radius-m)] [:not(.settings-row)_+_&]:[border-top-right-radius:var(--radius-m)]",
    "[&:not(:has(+_.settings-row))]:[border-bottom-color:transparent] [&:not(:has(+_.settings-row))]:[border-bottom-left-radius:var(--radius-m)] [&:not(:has(+_.settings-row))]:[border-bottom-right-radius:var(--radius-m)] [&:not(:has(+_.settings-row))]:mb-4",
    "[&.flash]:[animation:settings-flash_1.4s_ease-out] [&.settings-stack]:flex-col [&.settings-stack]:items-stretch [&.settings-stack]:gap-2",
    "[&.settings-stack_textarea]:w-full [&.settings-stack_textarea]:resize-y flex justify-between",
    "gap-6 [border-bottom:1px_solid_var(--line)] p-[12px_16px] items-center",
    "bg-fill",
    className,
  )} {...props} />
}
