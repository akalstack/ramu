import type { ReactNode } from 'react'
import { cn } from 'cn'

/** A rounded group of rows on the raised fill, like a Settings card. */
export function Group({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('overflow-hidden rounded-(--radius-m) bg-fill [&>*+*]:border-t [&>*+*]:border-(--line)', className)}
    >
      {children}
    </div>
  )
}

export function Row({ title, help, children }: { title: ReactNode; help?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <span className="min-w-0 flex-1">
        <strong className="flex items-center gap-2 font-medium">{title}</strong>
        {help && <span className="mt-0.5 block text-caption leading-[18px] text-muted-foreground">{help}</span>}
      </span>
      {children}
    </div>
  )
}
