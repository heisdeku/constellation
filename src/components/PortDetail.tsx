import {
  Code2,
  Copy,
  FolderOpen,
  Pause,
  Play,
  Square,
  Terminal,
  X,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { PortEntry } from '~/lib/api'
import {
  SCOPE_HINT,
  SCOPE_LABEL,
  commandArgs,
  folderFor,
  formatUptime,
  tildify,
  wellKnownName,
} from '~/lib/format'
import { useApp } from '~/lib/store'
import { reducedMotion } from '~/lib/motion'
import { useActions } from './actions'
import { Chip, StateDot, Tip, cx } from './ui'

const SLIDE_IN: KeyframeAnimationOptions = { duration: 280, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' }
const SLIDE_OUT: KeyframeAnimationOptions = {
  duration: 200,
  easing: 'cubic-bezier(0.4, 0, 1, 1)',
  fill: 'forwards',
}

/**
 * Slides in from the right edge when opened. When `closing` is set it lifts out of the
 * layout, so the table widens underneath at once, slides away, then calls `onClosed`.
 */
export function PortDetail({
  entry,
  closing,
  onClose,
  onClosed,
}: {
  entry: PortEntry
  closing: boolean
  onClose: () => void
  onClosed: () => void
}) {
  const { home, settings } = useApp()
  const actions = useActions()
  const p = entry.process
  const folder = folderFor(entry)
  const service = wellKnownName(entry.port)
  const args = commandArgs(p.command, p.exe)
  const heading = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)

  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    if (reducedMotion()) return
    panel.current?.animate([{ transform: 'translateX(100%)' }, { transform: 'none' }], SLIDE_IN)
  }, [])

  useEffect(() => {
    if (!closing) return
    const el = panel.current
    if (!el || reducedMotion()) {
      onClosed()
      return
    }
    const slide = el.animate([{ transform: 'none' }, { transform: 'translateX(100%)' }], SLIDE_OUT)
    slide.finished.then(onClosed, () => {})
    return () => slide.cancel()
  }, [closing])

  return (
    <aside
      ref={panel}
      aria-label={`Port ${entry.port}`}
      className={cx(
        'flex h-full w-[340px] shrink-0 flex-col border-l border-line bg-surface',
        closing && 'pointer-events-none absolute inset-y-0 right-0 z-10',
      )}
    >
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
        <div ref={heading} tabIndex={-1} className="flex items-baseline gap-2 outline-none">
          <span className="font-mono text-[15px] font-semibold tabular-nums text-ink">
            {entry.port}
          </span>
          <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">
            {entry.protocol}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="btn btn-ghost -mr-1.5 size-7 p-0"
        >
          <X size={13} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-line px-4 py-3.5">
          <div className="flex items-center gap-2">
            <StateDot state={p.state} paused={p.paused} />
            <span className="truncate text-[13.5px] font-semibold text-ink">
              {entry.docker?.name ?? p.name}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip tone={p.paused ? 'held' : 'live'}>{p.paused ? 'Paused' : p.state}</Chip>
            {service && <Chip tone="violet">{service}</Chip>}
            {entry.docker && <Chip tone="info">Docker</Chip>}
            {!p.ownedByMe && <Chip tone="neutral">{p.user}</Chip>}
          </div>
        </section>

        <section className="border-b border-line px-4 py-3.5">
          <Row label="PID" value={String(p.pid)} mono copyable onCopy={actions.copy} />
          <Row label="Parent PID" value={String(p.ppid)} mono />
          <Row label="User" value={p.user} />
          <Row label="Uptime" value={formatUptime(p.uptimeSeconds)} />
          <Row label="CPU" value={`${p.cpu.toFixed(1)}%`} mono />
          <Row label="Memory" value={`${p.mem.toFixed(1)}%`} mono />
        </section>

        <section className="border-b border-line px-4 py-3.5">
          <h3 className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-ink-faint">
            Binding
          </h3>
          <Tip content={SCOPE_HINT[entry.scope]} side="left">
            <span
              className={cx(
                'chip mb-2',
                entry.scope === 'lan'
                  ? 'border-held/25 bg-held/10 text-held'
                  : 'border-line bg-surface-2 text-ink-faint',
              )}
            >
              {SCOPE_LABEL[entry.scope]}
            </span>
          </Tip>
          <ul className="space-y-1">
            {entry.addresses.map((addr) => (
              <li
                key={addr}
                className="selectable font-mono text-[11.5px] text-ink-dim"
              >
                {addr}:{entry.port}
              </li>
            ))}
          </ul>
        </section>

        {entry.docker && (
          <section className="border-b border-line px-4 py-3.5">
            <h3 className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-ink-faint">
              Container
            </h3>
            <Row label="Name" value={entry.docker.name} />
            <Row label="Image" value={entry.docker.image} />
            <Row label="ID" value={entry.docker.containerId} mono />
          </section>
        )}

        <section className="border-b border-line px-4 py-3.5">
          <h3 className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-ink-faint">
            Location
          </h3>
          {folder ? (
            <>
              <p className="text-[12.5px] font-medium text-ink">{folder.label}</p>
              <p className="selectable mt-0.5 break-all font-mono text-[11px] text-ink-faint">
                {tildify(folder.path, home)}
              </p>
              {p.project && (
                <p className="mt-1.5 text-[11px] text-ink-faint">
                  Detected from{' '}
                  <span className="font-mono text-ink-dim">{p.project.marker}</span> ·{' '}
                  {p.project.kind}
                </p>
              )}
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                <button type="button" className="btn" onClick={() => void actions.reveal(entry)}>
                  <FolderOpen size={12} /> Finder
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void actions.openTerminal(entry)}
                >
                  <Terminal size={12} /> Terminal
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void actions.openEditor(entry)}
                >
                  <Code2 size={12} /> Editor
                </button>
              </div>
            </>
          ) : (
            <p className="text-[11.5px] leading-relaxed text-ink-faint">
              macOS only shows the folder for processes you own.
            </p>
          )}
        </section>

        <section className="px-4 py-3.5">
          <h3 className="mb-2 flex items-center justify-between text-[10.5px] font-medium uppercase tracking-wider text-ink-faint">
            Command
            <button
              type="button"
              aria-label="Copy command"
              className="btn btn-ghost size-6 p-0"
              onClick={() => void actions.copy(p.command, 'Command')}
            >
              <Copy size={11} />
            </button>
          </h3>
          <p className="selectable break-all font-mono text-[11px] leading-relaxed text-ink-dim">
            <span className="text-ink">{p.exe}</span>
            {args && <span className="text-ink-faint"> {args}</span>}
          </p>
        </section>
      </div>

      <footer className="flex shrink-0 gap-2 border-t border-line p-3">
        <button
          type="button"
          disabled={!p.ownedByMe || p.protected}
          onClick={() => (p.paused ? void actions.resume(entry) : void actions.pause(entry))}
          className={cx('btn flex-1', p.paused && 'border-held/40 bg-held/10 text-held')}
        >
          {p.paused ? <Play size={12} /> : <Pause size={12} />}
          {p.paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          disabled={!p.ownedByMe || p.protected}
          onClick={() => actions.stop(entry)}
          className="btn btn-danger flex-1"
        >
          <Square size={11} /> {settings.confirmStop ? 'Stop…' : 'Stop'}
        </button>
      </footer>
    </aside>
  )
}

function Row({
  label,
  value,
  mono,
  copyable,
  onCopy,
}: {
  label: string
  value: string
  mono?: boolean
  copyable?: boolean
  onCopy?: (text: string, what: string) => Promise<void>
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="shrink-0 text-[11.5px] text-ink-faint">{label}</span>
      <span
        className={cx(
          'selectable min-w-0 truncate text-right text-[12px] text-ink-dim',
          mono && 'font-mono tabular-nums',
        )}
      >
        {value}
        {copyable && onCopy && (
          <button
            type="button"
            aria-label={`Copy ${label}`}
            className="-my-1 ml-1 inline-flex size-5 items-center justify-center rounded align-middle text-ink-faint hover:bg-surface-3 hover:text-ink"
            onClick={() => void onCopy(value, label)}
          >
            <Copy size={10} />
          </button>
        )}
      </span>
    </div>
  )
}
