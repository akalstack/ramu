import { CircleCheck, Info, OctagonX, TriangleAlert } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import type { ReactNode } from 'react'
import { Toast, ToastAction, ToastClose, ToastContent, ToastDescription, ToastPortal, ToastProvider, ToastTitle, ToastViewport, toast, useToastManager } from '@/components/ui/toast'

/** What Ramu attaches to a toast: an icon of its own (a provider logo, say) and a hook for when the user dismisses it. */
export type AppToastData = { icon?: ReactNode; onDismiss?: () => void }

/** The app-wide toast manager (shadcn's). Add, update, close and promise toasts from anywhere. */
export const notify = toast

const TYPE_ICON: Record<string, ReactNode> = {
  success: <CircleCheck className="text-[var(--ok)]" />,
  info: <Info />,
  warning: <TriangleAlert className="text-[var(--warn)]" />,
  error: <OctagonX className="text-destructive" />,
  loading: <Spinner />,
}

function AppToastList({ closeLabel }: { closeLabel: string }) {
  const { toasts } = useToastManager()
  return toasts.map((item) => {
    const data = item.data as AppToastData | undefined
    const icon = data?.icon ?? (item.type ? TYPE_ICON[item.type] : null)
    return <Toast key={item.id} toast={item}>
      <ToastContent>
        {icon && <span data-slot="toast-icon" className="shrink-0 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4">{icon}</span>}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <ToastTitle />
          <ToastDescription />
        </div>
        <ToastAction />
        {/* Only a click here counts as the user dismissing it; timeouts and programmatic closes don't call onDismiss. */}
        <ToastClose aria-label={closeLabel} onClick={() => data?.onDismiss?.()} />
      </ToastContent>
    </Toast>
  })
}

/** shadcn's Toaster, composed for Ramu: bottom-right above the status bar, with per-toast icons and dismiss hooks. */
export function AppToaster({ label, closeLabel }: { label: string; closeLabel: string }) {
  return <ToastProvider toastManager={toast} limit={4}>
    <ToastPortal>
      <ToastViewport aria-label={label} className="app-toast-viewport">
        <AppToastList closeLabel={closeLabel} />
      </ToastViewport>
    </ToastPortal>
  </ToastProvider>
}
