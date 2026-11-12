import { useEffect, useState } from 'react'
import { Link, Outlet, createRootRoute } from '@tanstack/react-router'
import { Toast } from '@base-ui-components/react/toast'
import { Tooltip } from '@base-ui-components/react/tooltip'
import { HardDrive, Plug, Search, Settings } from 'lucide-react'
import { CommandPalette } from '~/components/CommandPalette'
import { Logo } from '~/components/Logo'
import { ToastViewport } from '~/components/Toaster'
import { Tip } from '~/components/ui'
import { formatBytes } from '~/lib/format'
import { AppProvider } from '~/lib/store'
import { StorageProvider, useStorage } from '~/lib/storage'

export const Route = createRootRoute({ component: RootLayout })

function RootLayout() {
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <Tooltip.Provider delay={450}>
      <Toast.Provider limit={4}>
        <AppProvider>
          <StorageProvider>
            <div className="flex h-full bg-canvas">
              <Sidebar onSearch={() => setPaletteOpen(true)} />
              <main className="my-2 mr-2 min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-surface">
                <Outlet />
              </main>
            </div>
            <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
            <ToastViewport />
          </StorageProvider>
        </AppProvider>
      </Toast.Provider>
    </Tooltip.Provider>
  )
}

const NAV = [
  { to: '/', label: 'Ports', icon: Plug },
  { to: '/storage', label: 'Storage', icon: HardDrive },
] as const

function Sidebar({ onSearch }: { onSearch: () => void }) {
  const link = (to: string, label: string, Icon: typeof Plug) => (
    <Link
      key={to}
      to={to}
      viewTransition
      className="relative isolate flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-ink-dim transition-colors hover:text-ink"
      activeProps={{ className: '!text-ink' }}
      activeOptions={{ exact: to === '/', includeSearch: false }}
    >
      {({ isActive }) => (
        <>
          {/* One highlight, carried from the old page's link to the new one by name. */}
          {isActive && (
            <span
              aria-hidden
              className="absolute inset-0 -z-10 rounded-lg bg-surface-2"
              style={{ viewTransitionName: 'nav-highlight' }}
            />
          )}
          <Icon size={15} className="shrink-0" />
          {label}
        </>
      )}
    </Link>
  )

  return (
    <aside className="flex w-[216px] shrink-0 flex-col px-3 pb-3">
      {/* The window's traffic lights sit here; the strip drags the window. */}
      <div className="drag-region h-11 shrink-0" />

      <div className="mb-4 flex items-center gap-2 px-1.5">
        <Logo />
        <span className="text-[14px] font-semibold tracking-tight text-ink">marè</span>
        <Tip content="Search  ⌘K" side="bottom">
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search"
            aria-keyshortcuts="Meta+K"
            className="btn btn-ghost ml-auto px-1.5"
          >
            <Search size={14} />
          </button>
        </Tip>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-col gap-0.5">
          {NAV.map((item) => link(item.to, item.label, item.icon))}
        </div>
        <div className="mt-auto flex flex-col gap-3">
          {link('/settings', 'Settings', Settings)}
          <DiskMeter />
        </div>
      </nav>
    </aside>
  )
}

function DiskMeter() {
  const { disk } = useStorage()
  // Holds its place before the numbers arrive, so Settings above it never moves.
  const used = disk ? (disk.totalBytes - disk.freeBytes) / disk.totalBytes : 0

  return (
    <Link
      to="/storage"
      search={{}}
      className="block rounded-lg border border-line px-3 py-2.5 transition-colors hover:bg-surface-2"
    >
      <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
        <span className="text-ink-dim">Disk</span>
        <span className="tabular-nums text-ink-faint">
          {disk ? `${formatBytes(disk.freeBytes)} free` : 'Reading…'}
        </span>
      </div>
      <div
        role="img"
        aria-label={disk ? `${Math.round(used * 100)}% of disk used` : 'Reading disk usage'}
        className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3"
      >
        <div className="h-full bg-ink-dim" style={{ width: `${used * 100}%` }} />
      </div>
    </Link>
  )
}
