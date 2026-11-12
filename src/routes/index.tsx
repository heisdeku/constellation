import { useEffect, useMemo, useRef } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, Pause, Play, Plug, RefreshCw, Search, SearchX, X } from 'lucide-react'
import { ActionsProvider } from '~/components/actions'
import { PortDetail } from '~/components/PortDetail'
import { PortsTable } from '~/components/PortsTable'
import { Empty, PageHeader, SelectField, Tip, cx } from '~/components/ui'
import {
  DEFAULT_SEARCH,
  filterAndSort,
  parseSearch,
  type PortsSearch,
  type SortKey,
} from '~/lib/filter'
import { formatClock } from '~/lib/format'
import { useApp } from '~/lib/store'

export const Route = createFileRoute('/')({
  component: PortsPage,
  validateSearch: parseSearch,
})

const PROTO_ITEMS = [
  { value: 'all', label: 'All protocols' },
  { value: 'tcp', label: 'TCP only' },
  { value: 'udp', label: 'UDP only' },
] as const

const SCOPE_ITEMS = [
  { value: 'all', label: 'Any reach' },
  { value: 'loopback', label: 'Local only' },
  { value: 'lan', label: 'On network' },
] as const

function PortsPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { entries, settings, initialising, error, warnings } = useApp()
  const { tracking, setTracking, scanning, scannedAt, refresh } = useApp()
  const searchRef = useRef<HTMLInputElement>(null)

  const setSearch = (patch: Partial<PortsSearch>, viewTransition = false) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, viewTransition })

  const select = (sel: string | null) => void setSearch({ sel: sel ?? undefined }, true)

  // Focus goes back to the row that opened the panel, so the keyboard picks up there.
  const closeDetail = async () => {
    const id = search.sel
    await setSearch({ sel: undefined }, true)
    if (id) document.querySelector<HTMLElement>(`[data-motion-key="${CSS.escape(id)}"]`)?.focus()
  }

  const visible = useMemo(
    () => filterAndSort(entries, search, settings.hideSystem),
    [entries, search, settings.hideSystem],
  )

  // Keep the panel honest: a selected process can exit between scans.
  const selected = visible.find((e) => e.id === search.sel) ?? null
  useEffect(() => {
    if (search.sel && !initialising && !entries.some((e) => e.id === search.sel)) {
      setSearch({ sel: undefined })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, search.sel, initialising])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
      if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onSort = (key: SortKey) =>
    setSearch(
      search.sort === key
        ? { dir: search.dir === 'asc' ? 'desc' : 'asc' }
        : { sort: key, dir: key === 'cpu' ? 'desc' : 'asc' },
    )

  const filtersActive =
    search.q !== '' || search.proto !== 'all' || search.scope !== 'all'

  return (
    <ActionsProvider>
      <div className="flex h-full">
        <div className="flex min-w-0 flex-1 flex-col">
          <PageHeader
            title="Ports"
            subtitle={
              <span className="flex items-center gap-1.5">
                <span
                  className={cx('size-[6px] rounded-full', tracking ? 'live-dot bg-live' : 'bg-held')}
                />
                {entries.length} listening
                {scannedAt && <span className="tabular-nums">· updated {formatClock(scannedAt)}</span>}
              </span>
            }
            actions={
              <>
                <Tip content="Rescan now">
                  <button
                    type="button"
                    onClick={() => void refresh()}
                    disabled={scanning}
                    aria-label="Rescan now"
                    className="btn btn-ghost px-1.5"
                  >
                    <RefreshCw size={13} className={scanning ? 'animate-spin' : undefined} />
                  </button>
                </Tip>
                <Tip content={tracking ? 'Pause live tracking' : 'Resume live tracking'}>
                  <button
                    type="button"
                    onClick={() => setTracking(!tracking)}
                    className={cx('btn', !tracking && 'border-held/40 bg-held/10 text-held')}
                  >
                    {tracking ? <Pause size={12} /> : <Play size={12} />}
                    {tracking ? 'Tracking' : 'Paused'}
                  </button>
                </Tip>
              </>
            }
          />
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-6 pb-4">
            <div className="relative min-w-0 flex-1">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <input
                ref={searchRef}
                type="text"
                value={search.q}
                onChange={(e) => setSearch({ q: e.target.value })}
                placeholder="Search port, process, project or PID…"
                aria-label="Search ports"
                className="field pl-8 pr-8"
              />
              {search.q && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearch({ q: '' })}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <SelectField
              ariaLabel="Filter by protocol"
              value={search.proto}
              onChange={(proto) => setSearch({ proto })}
              items={PROTO_ITEMS}
              className="w-[132px]"
            />
            <SelectField
              ariaLabel="Filter by reach"
              value={search.scope}
              onChange={(scope) => setSearch({ scope })}
              items={SCOPE_ITEMS}
              className="w-[124px]"
            />

            {filtersActive && (
              <button
                type="button"
                onClick={() => setSearch(DEFAULT_SEARCH)}
                className="btn btn-ghost"
              >
                Clear
              </button>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 border-b border-danger/25 bg-danger/10 px-4 py-2 text-[12px] text-danger">
              <AlertTriangle size={13} className="mt-px shrink-0" />
              <span className="selectable">{error}</span>
            </div>
          )}
          {warnings.map((w) => (
            <div
              key={w}
              className="border-b border-held/20 bg-held/10 px-4 py-1.5 text-[11.5px] text-held"
            >
              {w}
            </div>
          ))}

          <div className={cx('min-h-0 flex-1', initialising && 'opacity-60')}>
            {initialising ? (
              <Empty
                icon={<Plug size={26} />}
                title="Scanning ports…"
              />
            ) : error && entries.length === 0 ? (
              <Empty
                icon={<AlertTriangle size={26} />}
                title="Couldn't scan ports"
                body={error}
              />
            ) : visible.length === 0 ? (
              <Empty
                icon={filtersActive ? <SearchX size={26} /> : <Plug size={26} />}
                title={filtersActive ? 'Nothing matches' : 'No listening ports'}
                body={
                  filtersActive
                    ? 'Try a different search, or clear the filters.'
                    : settings.hideSystem
                      ? "Nothing of yours is listening. To see other users' ports, turn off Hide other users' ports in Settings."
                      : 'Nothing on this machine is listening for connections.'
                }
              />
            ) : (
              <PortsTable
                entries={visible}
                selectedId={search.sel ?? null}
                onSelect={select}
                sort={search.sort}
                dir={search.dir}
                onSort={onSort}
              />
            )}
          </div>

          <footer className="flex h-8 shrink-0 items-center justify-between border-t border-line px-6 text-[11px] text-ink-faint">
            <span>
              {visible.length} of {entries.length} shown
              {settings.hideSystem && ' · system ports hidden'}
            </span>
            <span>⌘F to search</span>
          </footer>
        </div>

        {selected && (
          <PortDetail entry={selected} onClose={() => void closeDetail()} />
        )}
      </div>
    </ActionsProvider>
  )
}
