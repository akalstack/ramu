import { CircleCheck, Info, OctagonX, TriangleAlert } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { useLayoutEffect, type ReactNode } from 'react'
import { cn } from 'cn'
import { Button } from './desktop-button'
import {
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  toast,
  useToastManager,
} from '@/components/ui/toast'

/** What Ramu attaches to a toast: an icon of its own (a provider logo, say) and a hook for when the user dismisses it. */
export type AppToastData = {
  icon?: ReactNode
  onDismiss?: () => void
  /** A quieter second choice beside the action, such as picking which updates to install. */
  secondary?: { label: string; onClick: () => void }
}

/** The app-wide toast manager (shadcn's). Add, update, close and promise toasts from anywhere. */
export const notify = toast

const TYPE_ICON: Record<string, ReactNode> = {
  success: <CircleCheck className="text-[var(--ok)]" />,
  info: <Info />,
  warning: <TriangleAlert className="text-[var(--warn)]" />,
  error: <OctagonX className="text-destructive" />,
  loading: <Spinner />,
}

/** The toasts an open panel already lists, to close; one still in progress (an update installing) stays. */
export function listedToasts(
  toasts: readonly { id: string; type?: string; transitionStatus?: 'starting' | 'ending' }[],
  listed: ReadonlySet<string>,
): string[] {
  return toasts
    .filter((item) => listed.has(item.id) && item.type !== 'loading' && item.transitionStatus !== 'ending')
    .map((item) => item.id)
}

function AppToastList({ closeLabel, listed }: { closeLabel: string; listed: ReadonlySet<string> }) {
  const { toasts, close } = useToastManager()
  // Before paint, so a listed toast never lands on the panel that shows it.
  useLayoutEffect(() => {
    for (const id of listedToasts(toasts, listed)) close(id)
  }, [toasts, listed, close])
  return toasts.map((item) => {
    const data = item.data as AppToastData | undefined
    const icon = data?.icon ?? (item.type ? TYPE_ICON[item.type] : null)
    return (
      <Toast key={item.id} toast={item}>
        <ToastContent>
          {icon && (
            <span
              data-slot="toast-icon"
              className="shrink-0 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4"
            >
              {icon}
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <ToastTitle />
            <ToastDescription />
          </div>
          {data?.secondary && (
            <Button variant="ghost" size="sm" className="shrink-0" onClick={data.secondary.onClick}>
              {data.secondary.label}
            </Button>
          )}
          <ToastAction />
          {/* Only a click here counts as the user dismissing it; timeouts and programmatic closes don't call onDismiss. */}
          <ToastClose aria-label={closeLabel} onClick={() => data?.onDismiss?.()} />
        </ToastContent>
      </Toast>
    )
  })
}

/** shadcn's Toaster, composed for Ramu: bottom-right above the status bar, with per-toast icons and dismiss hooks. */
export function AppToaster({
  label,
  closeLabel,
  clearBottom,
  listed,
}: {
  label: string
  closeLabel: string
  /** Pixels above the bottom edge an open status-bar popover covers; toasts stack above it so neither hides the other. */
  clearBottom: number | null
  /** Toast ids an open panel already lists; they close rather than show the same item twice. */
  listed: ReadonlySet<string>
}) {
  const bottom = clearBottom === null ? 36 : clearBottom + 8
  return (
    <ToastProvider toastManager={toast} limit={4}>
      <ToastPortal>
        <ToastViewport
          aria-label={label}
          className={cn(
            'app-toast-viewport left-auto right-3 w-[min(380px,_calc(100vw_-_24px))] z-1250 transition-[bottom] duration-150 motion-reduce:transition-none',
          )}
          style={{ bottom }}
        >
          <AppToastList closeLabel={closeLabel} listed={listed} />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  )
}
