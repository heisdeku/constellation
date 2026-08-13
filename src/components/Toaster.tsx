import { Toast } from '@base-ui-components/react/toast'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

/** Re-exported so callers don't need to know which toast library is underneath. */
export const useToast = Toast.useToastManager

const ICONS: Record<string, React.ReactNode> = {
  success: <CheckCircle2 size={14} className="text-live" />,
  error: <AlertTriangle size={14} className="text-danger" />,
  info: <Info size={14} className="text-info" />,
}

function ToastList() {
  const { toasts } = useToast()
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      swipeDirection="right"
      className={[
        'pointer-events-auto relative w-full rounded-lg border border-line bg-surface-2',
        'p-3 pr-8 shadow-2xl shadow-black/60',
        'transition-all duration-300 ease-out',
        'data-[starting-style]:translate-x-6 data-[starting-style]:opacity-0',
        'data-[ending-style]:translate-x-6 data-[ending-style]:opacity-0',
      ].join(' ')}
    >
      <div className="flex gap-2.5">
        <span className="mt-px shrink-0">{ICONS[toast.type ?? 'info'] ?? ICONS.info}</span>
        <div className="min-w-0 flex-1">
          <Toast.Title className="text-[12.5px] font-medium text-ink" />
          <Toast.Description className="selectable mt-0.5 break-words text-[11.5px] leading-snug text-ink-faint" />
          {toast.actionProps && (
            <Toast.Action className="btn btn-danger mt-2 py-1 text-[11.5px]" />
          )}
        </div>
      </div>
      <Toast.Close
        aria-label="Dismiss"
        className="absolute right-2 top-2 rounded p-1 text-ink-faint hover:bg-surface-3 hover:text-ink"
      >
        <X size={12} />
      </Toast.Close>
    </Toast.Root>
  ))
}

export function ToastViewport() {
  return (
    <Toast.Portal>
      <Toast.Viewport className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[350px] flex-col-reverse gap-2 outline-none">
        <ToastList />
      </Toast.Viewport>
    </Toast.Portal>
  )
}
