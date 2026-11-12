import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Dialog } from '@base-ui-components/react/dialog'
import { ArrowDown, ArrowUp, CornerDownLeft, HardDrive, Plug, Search, Settings } from 'lucide-react'
import { CATEGORIES } from '~/lib/categories'
import { DEFAULT_SEARCH } from '~/lib/filter'
import { wellKnownName } from '~/lib/format'
import { useApp } from '~/lib/store'
import { cx } from './ui'

interface Item {
  id: string
  section: 'Pages' | 'Ports' | 'Storage'
  label: string
  meta: string
  icon: React.ReactNode
  keywords: string
  run: () => void
}

/** Jump to any page, port or storage category from the keyboard. Opens with ⌘K. */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const { entries } = useApp()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  const go = (to: () => void) => () => {
    onOpenChange(false)
    to()
  }

  const items: Item[] = [
    {
      id: 'page-ports',
      section: 'Pages',
      label: 'Ports',
      meta: `${entries.length} listening`,
      icon: <Plug size={14} />,
      keywords: 'processes servers',
      run: go(() => void navigate({ to: '/', search: DEFAULT_SEARCH })),
    },
    {
      id: 'page-storage',
      section: 'Pages',
      label: 'Storage',
      meta: 'Disk',
      icon: <HardDrive size={14} />,
      keywords: 'disk space clean caches',
      run: go(() => void navigate({ to: '/storage', search: {} })),
    },
    {
      id: 'page-settings',
      section: 'Pages',
      label: 'Settings',
      meta: 'Preferences',
      icon: <Settings size={14} />,
      keywords: 'preferences options',
      run: go(() => void navigate({ to: '/settings' })),
    },
    ...entries.map((entry) => ({
      id: `port-${entry.id}`,
      section: 'Ports' as const,
      label: `${entry.port}  ${entry.docker?.name ?? entry.process.name}`,
      meta: entry.process.project?.name ?? wellKnownName(entry.port) ?? entry.protocol,
      icon: <span className="size-[7px] rounded-full bg-live" />,
      keywords: `${entry.process.command} ${entry.pid}`,
      run: go(() => void navigate({ to: '/', search: { ...DEFAULT_SEARCH, sel: entry.id } })),
    })),
    ...CATEGORIES.filter((c) => c.id !== 'macos').map((c) => ({
      id: `category-${c.id}`,
      section: 'Storage' as const,
      label: c.label,
      meta: 'Storage category',
      icon: <c.icon size={14} />,
      keywords: '',
      run: go(() => void navigate({ to: '/storage', search: { category: c.id } })),
    })),
  ]

  const needle = query.trim().toLowerCase()
  const matches = needle
    ? items.filter((item) => `${item.label} ${item.meta} ${item.keywords}`.toLowerCase().includes(needle))
    : items

  useEffect(() => setActive(0), [query, open])
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (matches.length === 0 ? 0 : (i + step + matches.length) % matches.length))
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      matches[active]?.run()
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          aria-label="Search"
          className="popup fixed left-1/2 top-[14%] z-50 flex max-h-[min(520px,70vh)] w-[min(600px,calc(100vw-48px))] -translate-x-1/2 flex-col overflow-hidden rounded-xl p-0"
          onKeyDown={onKeyDown}
        >
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search size={15} className="shrink-0 text-ink-faint" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ports, storage and pages"
              aria-label="Search"
              className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
            />
          </div>

          <div ref={list} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
            {matches.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12.5px] text-ink-faint">
                Nothing matches "{query}".
              </p>
            ) : (
              matches.map((item, index) => (
                <div key={item.id}>
                  {matches[index - 1]?.section !== item.section && (
                    <p className="px-3 pb-1.5 pt-3 text-[10.5px] font-medium uppercase tracking-wider text-ink-faint">
                      {item.section}
                    </p>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    data-index={index}
                    onMouseMove={() => setActive(index)}
                    onClick={item.run}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left',
                      index === active && 'bg-surface-3',
                    )}
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center text-ink-dim">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                      {item.label}
                    </span>
                    <span className="shrink-0 text-[12px] text-ink-faint">{item.meta}</span>
                    {index === active && (
                      <CornerDownLeft size={13} className="shrink-0 text-ink-faint" />
                    )}
                  </button>
                </div>
              ))
            )}
          </div>

          <footer className="flex items-center gap-4 border-t border-line px-4 py-2.5 text-[11.5px] text-ink-faint">
            <span className="flex items-center gap-1.5">
              <Key>
                <ArrowUp size={11} />
              </Key>
              <Key>
                <ArrowDown size={11} />
              </Key>
              navigate
            </span>
            <span className="flex items-center gap-1.5">
              <Key>
                <CornerDownLeft size={11} />
              </Key>
              open
            </span>
            <span className="flex items-center gap-1.5">
              <Key>Esc</Key>
              close
            </span>
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const Key = ({ children }: { children: React.ReactNode }) => (
  <kbd className="flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1 font-sans text-[10.5px] text-ink-dim">
    {children}
  </kbd>
)
