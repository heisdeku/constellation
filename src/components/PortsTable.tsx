import { ContextMenu } from '@base-ui-components/react/context-menu'
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
import { SCOPE_HINT, SCOPE_LABEL, folderFor, tildify, wellKnownName } from '~/lib/format'
import { useListMotion } from '~/lib/motion'
import { useApp } from '~/lib/store'
import { useActions } from './actions'
import { Chip, StateDot, Tip, cx } from './ui'
import type { SortDir, SortKey } from '~/lib/filter'

const entryKey = (entry: PortEntry) => entry.id

const GRID =
  'grid grid-cols-[72px_minmax(0,1.5fr)_minmax(0,1.2fr)_88px_96px] @3xl:grid-cols-[86px_minmax(0,1.5fr)_minmax(0,1.35fr)_104px_66px_60px_96px] items-center gap-3 px-6'
const WIDE_ONLY = 'hidden text-right @3xl:block'

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
  const motion = useListMotion(entries, entryKey)

  return (
    <div
      ref={motion.ref}
      role="listbox"
      aria-label="Listening ports"
      onKeyDown={(e) => moveSelection(e, onSelect)}
      className="@container relative h-full overflow-y-auto"
    >
      <div
        className={cx(
          GRID,
          'sticky top-0 z-10 h-8 border-b border-line bg-surface text-[10.5px] font-medium uppercase tracking-wider text-ink-faint',
        )}
      >
        <SortHeader label="Port" k="port" sort={sort} dir={dir} onSort={onSort} />
        <SortHeader label="Process" k="process" sort={sort} dir={dir} onSort={onSort} />
        <SortHeader label="Folder" k="project" sort={sort} dir={dir} onSort={onSort} />
        <span>Reach</span>
        <SortHeader label="PID" k="pid" sort={sort} dir={dir} onSort={onSort} numeric />
        <SortHeader label="CPU" k="cpu" sort={sort} dir={dir} onSort={onSort} numeric />
        <span />
      </div>

      {motion.items.map(({ item: entry, leaving }) => (
        <Row
          key={entry.id}
          entry={entry}
          selected={entry.id === selectedId}
          focusable={selectedId ? entry.id === selectedId : entry.id === entries[0]?.id}
          leaving={leaving}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

/**
 * Moves the selection with the arrow keys, Home and End, the way a macOS table does,
 * focusing the row it lands on.
 */
function moveSelection(e: React.KeyboardEvent<HTMLElement>, onSelect: (id: string) => void) {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(':scope > [data-motion-key]:not([data-leaving])')]
  const current = rows.findIndex((row) => row.contains(document.activeElement))
  if (current === -1) return
  e.preventDefault()
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? rows.length - 1
        : Math.min(rows.length - 1, Math.max(0, current + (e.key === 'ArrowDown' ? 1 : -1)))
  rows[next].focus()
  rows[next].scrollIntoView({ block: 'nearest' })
  onSelect(rows[next].dataset.motionKey as string)
}

function SortHeader({
  label,
  k,
  sort,
  dir,
  onSort,
  numeric,
}: {
  label: string
  numeric?: boolean
  k: SortKey
  sort: SortKey
  dir: SortDir
  onSort: (key: SortKey) => void
}) {
  const active = sort === k
  const arrow = active && (dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cx(
        'items-center gap-1 uppercase tracking-wider transition-colors hover:text-ink-dim',
        numeric ? 'hidden justify-end text-right @3xl:flex' : 'flex text-left',
        active && 'text-ink-dim',
      )}
    >
      {numeric && arrow}
      {label}
      {!numeric && arrow}
    </button>
  )
}

function Row({
  entry,
  selected,
  focusable,
  leaving,
  onSelect,
}: {
  entry: PortEntry
  selected: boolean
  focusable: boolean
  leaving: boolean
  onSelect: (id: string | null) => void
}) {
  const { home, settings } = useApp()
  const actions = useActions()
  const busy = actions.busyPid === entry.pid
  const p = entry.process
  const folder = folderFor(entry)
  const service = wellKnownName(entry.port)
  const label = entry.docker?.name ?? p.name

  return (
    <ContextMenu.Root>
    <ContextMenu.Trigger
      data-motion-key={entry.id}
      data-leaving={leaving || undefined}
      inert={leaving}
      role="option"
      aria-selected={selected}
      tabIndex={focusable ? 0 : -1}
      onClick={() => onSelect(entry.id)}
      onContextMenu={() => onSelect(entry.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(entry.id)
        }
      }}
      className={cx(
        GRID,
        'h-[52px] cursor-default border-b border-line-soft text-[12.5px] transition-colors',
        selected ? 'bg-info/20 shadow-[inset_2px_0_0_var(--color-info)]' : 'hover:bg-surface-2',
        p.paused && 'opacity-70',
      )}
    >
      <div className="flex flex-col">
        <span
          className="w-fit font-mono text-[14px] font-semibold tabular-nums text-ink"
        >
          {entry.port}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-ink-faint">
          {entry.protocol}
        </span>
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <StateDot state={p.state} paused={p.paused} />
          <span
            className="truncate font-medium text-ink"
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
              tabIndex={-1}
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
          <span className="text-[11.5px] text-ink-faint">—</span>
        )}
      </div>

      <div>
        <Tip content={SCOPE_HINT[entry.scope]}>
          <span>
            <Chip tone={entry.scope === 'lan' ? 'held' : 'neutral'}>{SCOPE_LABEL[entry.scope]}</Chip>
          </span>
        </Tip>
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

      <div
        className="-mr-2 flex items-center justify-end gap-1"
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
                tabIndex={-1}
                className={cx('btn btn-ghost size-7 p-0', p.paused && 'text-held')}
              >
                {p.paused ? <Play size={13} /> : <Pause size={13} />}
              </button>
            </Tip>

            <Tip content={p.protected ? 'Protected system process' : settings.confirmStop ? 'Stop…' : 'Stop'}>
              <button
                type="button"
                aria-label="Stop process"
                disabled={!p.ownedByMe || p.protected}
                tabIndex={-1}
                onClick={() => actions.stop(entry)}
                className="btn btn-ghost btn-danger size-7 p-0"
              >
                <Square size={12} />
              </button>
            </Tip>

            <RowMenu entry={entry} />
          </>
        )}
      </div>
    </ContextMenu.Trigger>
    <ContextMenu.Portal>
      <ContextMenu.Positioner>
        <ContextMenu.Popup className="popup min-w-[212px]">
          {p.ownedByMe && !p.protected && (
            <>
              <Menu.Item
                className="menu-item"
                onClick={() => (p.paused ? void actions.resume(entry) : void actions.pause(entry))}
              >
                {p.paused ? <Play size={13} /> : <Pause size={13} />}
                {p.paused ? 'Resume' : 'Pause'}
              </Menu.Item>
              <Menu.Item className="menu-item" onClick={() => actions.stop(entry)}>
                <Square size={12} /> {settings.confirmStop ? 'Stop…' : 'Stop'}
              </Menu.Item>
              <Menu.Separator className="my-1 h-px bg-line" />
            </>
          )}
          <PortMenuItems entry={entry} />
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

function RowMenu({ entry }: { entry: PortEntry }) {
  return (
    <Menu.Root>
      <Menu.Trigger tabIndex={-1} aria-label="More actions" className="btn btn-ghost size-7 p-0">
        <MoreHorizontal size={13} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6}>
          <Menu.Popup className="popup min-w-[212px]">
            <PortMenuItems entry={entry} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/** The Finder, Terminal, editor and copy commands shared by the ⋯ menu and the right-click menu. */
function PortMenuItems({ entry }: { entry: PortEntry }) {
  const actions = useActions()
  const folder = folderFor(entry)

  return (
    <>
      {folder && !folder.missing && (
        <>
          <Menu.Item className="menu-item" onClick={() => void actions.reveal(entry)}>
            <FolderOpen size={13} /> Show in Finder
          </Menu.Item>
          <Menu.Item className="menu-item" onClick={() => void actions.openTerminal(entry)}>
            <Terminal size={13} /> Open in Terminal
          </Menu.Item>
          <Menu.Item className="menu-item" onClick={() => void actions.openEditor(entry)}>
            <Code2 size={13} /> Open in Editor
          </Menu.Item>
          <Menu.Separator className="my-1 h-px bg-line" />
        </>
      )}
      <Menu.Item className="menu-item" onClick={() => void actions.copy(String(entry.port), 'Port')}>
        <Copy size={13} /> Copy Port
      </Menu.Item>
      <Menu.Item className="menu-item" onClick={() => void actions.copy(String(entry.pid), 'PID')}>
        <Copy size={13} /> Copy PID
      </Menu.Item>
      <Menu.Item
        className="menu-item"
        onClick={() => void actions.copy(entry.process.command, 'Command')}
      >
        <Copy size={13} /> Copy Command
      </Menu.Item>
      {folder && (
        <Menu.Item className="menu-item" onClick={() => void actions.copy(folder.path, 'Path')}>
          <Copy size={13} /> Copy Folder Path
        </Menu.Item>
      )}
    </>
  )
}
