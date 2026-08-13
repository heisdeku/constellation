import { Link, Outlet, createRootRoute } from '@tanstack/react-router'
import { Toast } from '@base-ui-components/react/toast'
import { Tooltip } from '@base-ui-components/react/tooltip'
import { Pause, Play, RefreshCw } from 'lucide-react'
import { AppProvider, useApp } from '~/lib/store'
import { ToastViewport } from '~/components/Toaster'
import { Tip, cx } from '~/components/ui'
import { formatClock } from '~/lib/format'

export const Route = createRootRoute({ component: RootLayout })

function RootLayout() {
  return (
    <Tooltip.Provider delay={450}>
      <Toast.Provider limit={4}>
        <AppProvider>
          <div className="flex h-full flex-col bg-canvas">
            <TitleBar />
            <main className="min-h-0 flex-1">
              <Outlet />
            </main>
          </div>
          <ToastViewport />
        </AppProvider>
      </Toast.Provider>
    </Tooltip.Provider>
  )
}

const NAV = [
  { to: '/', label: 'Ports' },
  { to: '/settings', label: 'Settings' },
] as const

function TitleBar() {
  const { tracking, setTracking, scanning, scannedAt, entries, refresh } = useApp()

  return (
    <header className="drag-region flex h-[42px] shrink-0 items-center gap-3 border-b border-line bg-surface pl-[80px] pr-3">
      <span className="text-[12.5px] font-semibold tracking-tight text-ink">
        Port Tracker
      </span>

      <nav className="no-drag flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="rounded-md px-2.5 py-1 text-[12px] font-medium text-ink-faint transition-colors hover:text-ink-dim"
            activeProps={{ className: 'bg-surface-3 !text-ink' }}
            activeOptions={{ exact: item.to === '/' }}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <span className="hidden items-center gap-1.5 text-[11.5px] text-ink-faint sm:flex">
          <span
            className={cx(
              'size-[6px] rounded-full',
              tracking ? 'live-dot bg-live' : 'bg-held',
            )}
          />
          {entries.length} {entries.length === 1 ? 'port' : 'ports'}
          {scannedAt && (
            <span className="tabular-nums text-ink-faint/60">
              · {formatClock(scannedAt)}
            </span>
          )}
        </span>

        <Tip content="Rescan now">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={scanning}
            aria-label="Rescan now"
            className="btn btn-ghost no-drag px-1.5"
          >
            <RefreshCw size={13} className={scanning ? 'animate-spin' : undefined} />
          </button>
        </Tip>

        <Tip content={tracking ? 'Pause live tracking' : 'Resume live tracking'}>
          <button
            type="button"
            onClick={() => setTracking(!tracking)}
            className={cx('btn no-drag', tracking ? '' : 'border-held/40 bg-held/10 text-held')}
          >
            {tracking ? <Pause size={12} /> : <Play size={12} />}
            {tracking ? 'Tracking' : 'Paused'}
          </button>
        </Tip>
      </div>
    </header>
  )
}
