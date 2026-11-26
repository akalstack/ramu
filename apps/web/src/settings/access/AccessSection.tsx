import type { ReactNode } from 'react'

/** A part of Devices & access: a title a person scans for, what it is for, and its main actions. */
export function AccessSection({
  title,
  help,
  actions,
  children,
}: {
  title: string
  help?: string
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="mb-8" aria-label={title}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="m-0 text-body font-semibold">{title}</h4>
          {help && <p className="m-[2px_0_0] text-caption text-muted-foreground">{help}</p>}
        </div>
        {actions && <div className="flex flex-none items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </section>
  )
}
