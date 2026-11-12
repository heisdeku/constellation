import { Menu } from '@base-ui-components/react/menu'
import {
  ArrowDown,
  ArrowUp,
  Code2,
  Copy,
  FolderOpen,
  FolderX,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Square,
  Terminal,
} from 'lucide-react'
import type { PortEntry } from '~/lib/api'
import { folderFor, tildify, wellKnownName } from '~/lib/format'
import { useListMotion } from '~/lib/motion'
import { useApp } from '~/lib/store'
import { useActions } from './actions'
import { Chip, StateDot, Tip, cx } from './ui'
import type { SortDir, SortKey } from '~/lib/filter'

const entryKey = (entry: PortEntry) => entry.id

// PID and CPU drop out when the table is narrow, say beside the detail panel, which
// shows both anyway.
const GRID =
  'grid grid-cols-[72px_minmax(0,1.5fr)_minmax(0,1.2fr)_88px_96px] @3xl:grid-cols-[86px_minmax(0,1.5fr)_minmax(0,1.35fr)_104px_66px_60px_96px] items-center gap-3 px-6'
const WIDE_ONLY = 'hidden @3xl:block'

export function PortsTable({
  entries,
  selectedId,
  onSelect,
  sort,
  dir,
  onSort,
}: {
  entries: PortEntry[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  sort: SortKey
  dir: SortDir
  onSort: (key: SortKey) => void
}) {
  // Rescans land every few seconds; rows slide to their new place instead of jumping.
  const motion = useListMotion(entries, entryKey)

  return (
    <div className="@container flex h-full flex-col">
      <div
        className={cx(
          GRID,
          'h-8 shrink-0 border-b border-line bg-surface text-[10.5px] font-medium uppercase tracking-wider text-ink-faint',
        )}
      >
        <SortHeader label="Port" k="port" sort={sort} dir={dir} onSort={onSort} />
        <SortHeader label="Process" k="process" sort={sort} dir={dir} onSort={onSort} />
        <SortHeader label="Folder" k="project" sort={sort} dir={dir} onSort={onSort} />
        <span>Reach</span>
        <SortHeader label="PID" k="pid" sort={sort} dir={dir} onSort={onSort} className={WIDE_ONLY} />
        <SortHeader label="CPU" k="cpu" sort={sort} dir={dir} onSort={onSort} className={WIDE_ONLY} />
        <span className="text-right">Actions</span>
      </div>

      <div ref={motion.ref} className="relative min-h-0 flex-1 overflow-y-auto">
        {motion.items.map(({ item: entry, leaving }) => (
          <Row
            key={entry.id}
            entry={entry}
            selected={entry.id === selectedId}
            leaving={leaving}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}

function SortHeader({
  label,
  k,
  sort,
  dir,
  onSort,
  className,
}: {
  label: string
  className?: string
  k: SortKey
  sort: SortKey
  dir: SortDir
  onSort: (key: SortKey) => void
}) {
  const active = sort === k
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      className={cx(
        'flex items-center gap-1 text-left uppercase tracking-wider transition-colors hover:text-ink-dim',
        active && 'text-ink-dim',
        className,
      )}
    >
      {label}
      {active &&
        (dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
    </button>
  )
}

function Row({
  entry,
  selected,
  leaving,
  onSelect,
}: {
  entry: PortEntry
  selected: boolean
  leaving: boolean
  onSelect: (id: string | null) => void
}) {
  const { home } = useApp()
  const actions = useActions()
  const busy = actions.busyPid === entry.pid
  const p = entry.process
  const folder = folderFor(entry)
  const service = wellKnownName(entry.port)
  const label = entry.docker?.name ?? p.name
  // While a row's panel is open, the panel carries these names instead.
  const shared = !selected && !leaving

  return (
    <div
      data-motion-key={entry.id}
      data-leaving={leaving || undefined}
      inert={leaving}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(selected ? null : entry.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(selected ? null : entry.id)
        }
      }}
      className={cx(
        GRID,
        'h-[52px] cursor-default border-b border-line-soft text-[12.5px] transition-colors',
        selected ? 'bg-info/10' : 'hover:bg-surface-2',
        p.paused && 'opacity-70',
      )}
    >
      {/* Port */}
      <div className="flex flex-col">
        <span
          className="w-fit font-mono text-[14px] font-semibold tabular-nums text-ink"
          style={{ viewTransitionName: shared ? `port-${entry.id}` : undefined }}
        >
          {entry.port}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-ink-faint">
          {entry.protocol}
        </span>
      </div>

      {/* Process */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <StateDot state={p.state} paused={p.paused} />
          <span
            className="truncate font-medium text-ink"
            style={{ viewTransitionName: shared ? `proc-${entry.id}` : undefined }}
          >
            {label}
          </span>
          {p.paused && <Chip tone="held">Paused</Chip>}
          {entry.docker && <Chip tone="info">Docker</Chip>}
        </div>
        <p className="truncate text-[11px] text-ink-faint">
          {service ? `${service} · ` : ''}
          {p.command}
        </p>
      </div>

      {/* Folder */}
      <div className="min-w-0 overflow-hidden">
        {folder ? (
          <Tip
            content={
              folder.missing
                ? `${folder.path} was deleted, but this process is still running from it.`
                : `Reveal ${folder.path} in Finder`
            }
          >
            <button
              type="button"
              disabled={folder.missing}
              onClick={(e) => {
                e.stopPropagation()
                void actions.reveal(entry)
              }}
              className="group flex min-w-0 max-w-full flex-col items-start text-left disabled:cursor-default"
            >
              <span className="flex w-full min-w-0 items-center gap-1.5">
                {folder.missing ? (
                  <FolderX size={12} className="shrink-0 text-held" />
                ) : (
                  <FolderOpen
                    size={12}
                    className="shrink-0 text-ink-faint group-hover:text-info"
                  />
                )}
                <span
                  className={cx(
                    'truncate font-medium',
                    folder.missing
                      ? 'text-ink-faint line-through decoration-ink-faint/50'
                      : 'text-ink-dim group-hover:text-info',
                  )}
                >
                  {folder.label}
                </span>
                {folder.missing && <Chip tone="held" className="shrink-0">Deleted</Chip>}
              </span>
              <span className="w-full truncate pl-[18px] text-[10.5px] text-ink-faint">
                {tildify(folder.path, home)}
              </span>
            </button>
          </Tip>
        ) : (
          <span className="text-[11.5px] text-ink-faint/60">—</span>
        )}
      </div>

      {/* Reach */}
      <div>
        {entry.scope === 'lan' ? (
          <Chip tone="held">Network</Chip>
        ) : entry.scope === 'loopback' ? (
          <Chip tone="neutral">Local</Chip>
        ) : (
          <Chip tone="neutral">Bound</Chip>
        )}
      </div>

      <span className={cx(WIDE_ONLY, 'font-mono text-[11.5px] tabular-nums text-ink-faint')}>
        {entry.pid}
      </span>

      <span
        className={cx(
          WIDE_ONLY,
          'font-mono text-[11.5px] tabular-nums',
          p.cpu >= 50 ? 'text-danger' : p.cpu >= 10 ? 'text-held' : 'text-ink-faint',
        )}
      >
        {p.cpu.toFixed(1)}
      </span>

      {/* Actions */}
      <div
        className="flex items-center justify-end gap-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        {busy ? (
          <Loader2 size={13} className="mr-2 animate-spin text-ink-faint" />
        ) : (
          <>
            <Tip
              content={
                !p.ownedByMe
                  ? `Runs as ${p.user}, so marè can't control it`
                  : p.protected
                    ? 'Protected system process'
                    : p.paused
                      ? 'Resume'
                      : 'Pause, keeping its port'
              }
            >
              <button
                type="button"
                aria-label={p.paused ? 'Resume process' : 'Pause process'}
                disabled={!p.ownedByMe || p.protected}
                onClick={() =>
                  p.paused ? void actions.resume(entry) : void actions.pause(entry)
                }
                className={cx('btn btn-ghost px-1.5', p.paused && 'text-held')}
              >
                {p.paused ? <Play size={13} /> : <Pause size={13} />}
              </button>
            </Tip>

            <Tip content={p.protected ? 'Protected system process' : 'Stop'}>
              <button
                type="button"
                aria-label="Stop process"
                disabled={!p.ownedByMe || p.protected}
                onClick={() => actions.stop(entry)}
                className="btn btn-ghost btn-danger px-1.5"
              >
                <Square size={12} />
              </button>
            </Tip>

            <RowMenu entry={entry} />
          </>
        )}
      </div>
    </div>
  )
}

function RowMenu({ entry }: { entry: PortEntry }) {
  const actions = useActions()
  const folder = folderFor(entry)

  return (
    <Menu.Root>
      <Menu.Trigger aria-label="More actions" className="btn btn-ghost px-1.5">
        <MoreHorizontal size={13} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6}>
          <Menu.Popup className="popup min-w-[212px]">
            <Menu.Item
              className="menu-item"
              disabled={!folder}
              onClick={() => void actions.reveal(entry)}
            >
              <FolderOpen size={13} /> Reveal in Finder
            </Menu.Item>
            <Menu.Item
              className="menu-item"
              disabled={!folder}
              onClick={() => void actions.openTerminal(entry)}
            >
              <Terminal size={13} /> Open in Terminal
            </Menu.Item>
            <Menu.Item
              className="menu-item"
              disabled={!folder}
              onClick={() => void actions.openEditor(entry)}
            >
              <Code2 size={13} /> Open in editor
            </Menu.Item>
            <Menu.Separator className="my-1 h-px bg-line" />
            <Menu.Item
              className="menu-item"
              onClick={() => void actions.copy(String(entry.port), 'Port')}
            >
              <Copy size={13} /> Copy port
            </Menu.Item>
            <Menu.Item
              className="menu-item"
              onClick={() => void actions.copy(String(entry.pid), 'PID')}
            >
              <Copy size={13} /> Copy PID
            </Menu.Item>
            <Menu.Item
              className="menu-item"
              onClick={() => void actions.copy(entry.process.command, 'Command')}
            >
              <Copy size={13} /> Copy command
            </Menu.Item>
            {folder && (
              <Menu.Item
                className="menu-item"
                onClick={() => void actions.copy(folder.path, 'Path')}
              >
                <Copy size={13} /> Copy folder path
              </Menu.Item>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
