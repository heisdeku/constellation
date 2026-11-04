import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AlertDialog } from '@base-ui-components/react/alert-dialog'
import { Checkbox } from '@base-ui-components/react/checkbox'
import { AlertTriangle, Check, FolderSearch, HardDrive, RefreshCw } from 'lucide-react'
import { useToast } from '~/components/Toaster'
import { Chip, Tip, cx } from '~/components/ui'
import {
  errorMessage,
  revealInFinder,
  type DiskUsage,
  type Measurement,
  type StorageGroup,
  type StorageSafety,
  type StorageTarget,
} from '~/lib/api'
import { formatAge, formatBytes, tildify } from '~/lib/format'
import { useApp } from '~/lib/store'
import { useStorage } from '~/lib/storage'

export const Route = createFileRoute('/storage')({ component: StoragePage })

/** Below this a row is noise: dozens of apps keep a few kilobytes of cache. */
const MIN_ROW_BYTES = 1_000_000
const COLLAPSED_ROWS = 8
/** Past this ratio, explain why the size shown is smaller than Finder or `du`. */
const SHARED_HINT_RATIO = 1.5

const GROUPS: ReadonlyArray<{ id: StorageGroup; title: string; hint: string }> = [
  { id: 'packages', title: 'Package managers', hint: 'Downloads kept in case you need them again.' },
  { id: 'apps', title: 'App caches and logs', hint: 'Most of what macOS calls System Data.' },
  { id: 'mobile', title: 'Xcode and simulators', hint: 'Build output and device images.' },
  { id: 'hidden', title: 'Hidden system files', hint: "Folders Finder and System Settings don't show." },
  { id: 'projects', title: 'Project build folders', hint: 'Dependencies and build output in your code folders.' },
]

const SAFETY: Record<StorageSafety, { label: string; tone: 'live' | 'held' | 'neutral' }> = {
  safe: { label: 'Safe', tone: 'live' },
  review: { label: 'Review', tone: 'held' },
  keep: { label: 'Keep', tone: 'neutral' },
}

function StoragePage() {
  const storage = useStorage()
  const { disk, targets, measurements, measuredCount, scanning, cleaning, error, selected } =
    storage
  const { scan, setSelected } = storage
  const { entries, home } = useApp()
  const [confirming, setConfirming] = useState(false)
  const toast = useToast()

  // Scanning walks millions of files, so it waits until this page is opened, and
  // the result is kept when you navigate away and back.
  useEffect(() => {
    if (targets.length === 0) void scan()
  }, [targets.length, scan])

  const reclaimable = (id: string) => measurements.get(id)?.reclaimableBytes ?? 0

  /** Project folders with a listening process: deleting these breaks something live. */
  const inUse = useMemo(() => {
    const roots = entries.flatMap((e) => e.process.project?.path ?? [])
    return new Set(
      targets
        .filter((t) => t.group === 'projects' && roots.some((r) => t.path.startsWith(`${r}/`)))
        .map((t) => t.id),
    )
  }, [entries, targets])

  const selectable = (t: StorageTarget) =>
    t.safety !== 'keep' && !inUse.has(t.id) && reclaimable(t.id) > 0

  const chosen = targets.filter((t) => selected.has(t.id) && selectable(t))
  const chosenBytes = chosen.reduce((sum, t) => sum + reclaimable(t.id), 0)
  const safeTargets = targets.filter((t) => t.safety === 'safe' && selectable(t))
  const safeBytes = safeTargets.reduce((sum, t) => sum + reclaimable(t.id), 0)
  const unreadable = [...measurements.values()].reduce((sum, m) => sum + m.unreadable, 0)

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    setSelected(next)
  }

  const runClean = async () => {
    setConfirming(false)
    const results = await storage.clean(chosen)
    const failures = [...results.entries()].flatMap(([id, r]) =>
      r instanceof Error
        ? [`${targets.find((t) => t.id === id)?.label}: ${r.message}`]
        : r.failures,
    )
    toast.add(
      failures.length === 0
        ? {
            title: `Cleaned ${chosen.length} ${chosen.length === 1 ? 'item' : 'items'}`,
            description: 'Free space on the disk is updated above.',
            type: 'success',
          }
        : {
            title: `${failures.length} ${failures.length === 1 ? 'item' : 'items'} couldn't be removed`,
            description: `${failures[0]} An app may be holding files open: quit it and try again.`,
            type: 'error',
            timeout: 10000,
          },
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[860px] px-6 py-6">
          <DiskSummary
            disk={disk}
            selectedBytes={chosenBytes}
            scanning={scanning}
            onScan={() => void scan()}
          />

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-[12px] text-danger">
              <AlertTriangle size={13} className="mt-px shrink-0" />
              <span className="selectable">{error}</span>
            </div>
          )}

          {unreadable > 0 && !scanning && (
            <p className="mb-4 rounded-md border border-held/20 bg-held/10 px-3 py-2 text-[11.5px] leading-relaxed text-held">
              macOS kept {unreadable.toLocaleString()} items private, so some sizes are
              low. Give System Manager Full Disk Access in System Settings › Privacy &amp;
              Security to see them.
            </p>
          )}

          {GROUPS.map((group) => (
            <GroupSection
              key={group.id}
              title={group.title}
              hint={group.hint}
              targets={targets.filter((t) => t.group === group.id)}
              measurements={measurements}
              selected={selected}
              inUse={inUse}
              home={home}
              selectable={selectable}
              onToggle={toggle}
            />
          ))}
        </div>
      </div>

      <footer className="flex h-12 shrink-0 items-center gap-3 border-t border-line bg-surface px-4">
        <span className="text-[11.5px] text-ink-faint">
          {scanning
            ? `Measuring ${measuredCount} of ${targets.length}…`
            : `${formatBytes(safeBytes)} safe to clean`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="btn"
            disabled={safeTargets.length === 0 || cleaning}
            onClick={() => setSelected(new Set(safeTargets.map((t) => t.id)))}
          >
            Select all safe
          </button>
          <button
            type="button"
            className="btn btn-accent"
            disabled={chosen.length === 0 || cleaning || scanning}
            onClick={() => setConfirming(true)}
          >
            {cleaning ? 'Cleaning…' : `Clean ${formatBytes(chosenBytes)}`}
          </button>
        </div>
      </footer>

      <ConfirmClean
        open={confirming}
        targets={chosen}
        bytes={chosenBytes}
        measurements={measurements}
        onClose={() => setConfirming(false)}
        onConfirm={() => void runClean()}
      />
    </div>
  )
}

function DiskSummary({
  disk,
  selectedBytes,
  scanning,
  onScan,
}: {
  disk: DiskUsage | null
  selectedBytes: number
  scanning: boolean
  onScan: () => void
}) {
  const used = disk ? disk.totalBytes - disk.freeBytes : 0
  const percent = (bytes: number) => (disk ? (bytes / disk.totalBytes) * 100 : 0)

  return (
    <section className="mb-7">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight text-ink">Storage</h1>
          <p className="mt-0.5 text-[12px] text-ink-faint">
            {disk
              ? `${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)}`
              : 'Reading your disk…'}
          </p>
        </div>
        <Tip content="Measure everything again">
          <button
            type="button"
            className="btn"
            disabled={scanning}
            onClick={onScan}
            aria-label="Rescan storage"
          >
            <RefreshCw size={12} className={scanning ? 'animate-spin' : undefined} />
            {scanning ? 'Scanning' : 'Rescan'}
          </button>
        </Tip>
      </div>
      <div
        role="img"
        aria-label={disk ? `${Math.round(percent(used))}% of disk used` : 'Disk usage'}
        className="flex h-2.5 overflow-hidden rounded-full bg-surface-3"
      >
        <div
          className="bg-ink-faint transition-[width] duration-300"
          style={{ width: `${percent(used - selectedBytes)}%` }}
        />
        <div
          className="bg-live transition-[width] duration-300"
          style={{ width: `${percent(selectedBytes)}%` }}
        />
      </div>
    </section>
  )
}

function GroupSection({
  title,
  hint,
  targets,
  measurements,
  selected,
  inUse,
  home,
  selectable,
  onToggle,
}: {
  title: string
  hint: string
  targets: StorageTarget[]
  measurements: ReadonlyMap<string, Measurement>
  selected: ReadonlySet<string>
  inUse: ReadonlySet<string>
  home: string
  selectable: (target: StorageTarget) => boolean
  onToggle: (id: string, on: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const rows = targets
    .filter((t) => (measurements.get(t.id)?.apparentBytes ?? 0) >= MIN_ROW_BYTES)
    .sort(
      (a, b) =>
        (measurements.get(b.id)?.reclaimableBytes ?? 0) -
        (measurements.get(a.id)?.reclaimableBytes ?? 0),
    )
  if (rows.length === 0) return null

  const total = rows.reduce((sum, t) => sum + (measurements.get(t.id)?.reclaimableBytes ?? 0), 0)
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS)

  return (
    <section className="mb-6">
      <div className="mb-1.5 flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[10.5px] font-medium uppercase tracking-wider text-ink-faint">
            {title}
          </h2>
          <p className="mt-0.5 text-[11.5px] text-ink-faint/70">{hint}</p>
        </div>
        <span className="shrink-0 text-[12px] font-medium tabular-nums text-ink-dim">
          {formatBytes(total)}
        </span>
      </div>
      <div className="divide-y divide-line-soft rounded-card border border-line bg-surface">
        {shown.map((target) => (
          <Row
            key={target.id}
            target={target}
            measurement={measurements.get(target.id)}
            checked={selected.has(target.id)}
            enabled={selectable(target)}
            running={inUse.has(target.id)}
            home={home}
            onToggle={(on) => onToggle(target.id, on)}
          />
        ))}
        {rows.length > COLLAPSED_ROWS && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="w-full px-4 py-2 text-left text-[11.5px] font-medium text-ink-faint transition-colors hover:text-ink-dim"
          >
            {expanded ? 'Show fewer' : `Show all ${rows.length}`}
          </button>
        )}
      </div>
    </section>
  )
}

function Row({
  target,
  measurement,
  checked,
  enabled,
  running,
  home,
  onToggle,
}: {
  target: StorageTarget
  measurement: Measurement | undefined
  checked: boolean
  enabled: boolean
  running: boolean
  home: string
  onToggle: (on: boolean) => void
}) {
  const toast = useToast()
  const apparent = measurement?.apparentBytes ?? 0
  const reclaimable = measurement?.reclaimableBytes ?? 0
  const shared = target.safety !== 'keep' && apparent > reclaimable * SHARED_HINT_RATIO

  const reveal = () =>
    revealInFinder(target.path).catch((e) =>
      toast.add({
        title: 'Could not open Finder',
        description: errorMessage(e),
        type: 'error',
      }),
    )

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Checkbox.Root
        checked={checked && enabled}
        disabled={!enabled}
        onCheckedChange={onToggle}
        aria-label={`Select ${target.label}`}
        className="flex size-4 shrink-0 items-center justify-center rounded border border-line
          bg-surface-3 transition-colors data-[checked]:border-live/50 data-[checked]:bg-live/25
          data-[disabled]:opacity-30"
      >
        <Checkbox.Indicator className="text-live">
          <Check size={11} strokeWidth={3} />
        </Checkbox.Indicator>
      </Checkbox.Root>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[12.5px] font-medium text-ink">{target.label}</span>
          <Chip tone={SAFETY[target.safety].tone}>{SAFETY[target.safety].label}</Chip>
          {running && <Chip tone="info">Running</Chip>}
        </div>
        <p className="mt-0.5 truncate text-[11.5px] text-ink-faint">
          {target.modifiedMs !== null && `${formatAge(target.modifiedMs)} · `}
          {target.detail}
        </p>
      </div>

      <Tip content={`Show ${tildify(target.path, home)} in Finder`}>
        <button
          type="button"
          onClick={() => void reveal()}
          aria-label={`Show ${target.label} in Finder`}
          className="btn btn-ghost px-1.5"
        >
          <FolderSearch size={13} />
        </button>
      </Tip>

      <Tip
        content={
          shared
            ? `Takes up ${formatBytes(apparent)} on paper, but most of it shares disk blocks with other files, so deleting it frees ${formatBytes(reclaimable)}.`
            : null
        }
      >
        <span
          className={cx(
            'w-[68px] shrink-0 text-right text-[12.5px] tabular-nums',
            reclaimable > 0 ? 'font-medium text-ink' : 'text-ink-faint',
          )}
        >
          {formatBytes(target.safety === 'keep' ? apparent : reclaimable)}
        </span>
      </Tip>
    </div>
  )
}

function ConfirmClean({
  open,
  targets,
  bytes,
  measurements,
  onClose,
  onConfirm,
}: {
  open: boolean
  targets: StorageTarget[]
  bytes: number
  measurements: ReadonlyMap<string, Measurement>
  onClose: () => void
  onConfirm: () => void
}) {
  const reviewed = targets.filter((t) => t.safety === 'review')

  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <AlertDialog.Popup className="popup fixed left-1/2 top-1/2 z-50 w-[460px] -translate-x-1/2 -translate-y-1/2 p-5">
          <AlertDialog.Title className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <HardDrive size={15} className="text-ink-faint" />
            Permanently delete {formatBytes(bytes)}?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
            These skip the Trash, because moving them there wouldn't free any space.
            {reviewed.length > 0 &&
              " Items marked Review won't rebuild on their own, so check them first."}
          </AlertDialog.Description>

          <ul className="mt-3 max-h-56 divide-y divide-line-soft overflow-y-auto rounded-md border border-line bg-canvas">
            {targets.map((target) => (
              <li key={target.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[11.5px]">
                <span className="min-w-0 flex-1 truncate text-ink-dim">{target.label}</span>
                {target.safety === 'review' && <Chip tone="held">Review</Chip>}
                <span className="shrink-0 tabular-nums text-ink-faint">
                  {formatBytes(measurements.get(target.id)?.reclaimableBytes ?? 0)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close className="btn">Cancel</AlertDialog.Close>
            <button
              type="button"
              className="btn border-danger/40 bg-danger/15 text-danger hover:!bg-danger/25"
              onClick={onConfirm}
            >
              Delete permanently
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
