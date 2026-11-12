import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { AlertDialog } from '@base-ui-components/react/alert-dialog'
import { Checkbox } from '@base-ui-components/react/checkbox'
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  FolderSearch,
  HardDrive,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useToast } from '~/components/Toaster'
import { Chip, Empty, Tip, cx } from '~/components/ui'
import {
  errorMessage,
  openPath,
  openPrivacySettings,
  revealInFinder,
  type DiskUsage,
  type Measurement,
  type StorageGroup,
  type StorageSafety,
  type StorageTarget,
} from '~/lib/api'
import { basename, formatAge, formatBytes, tildify } from '~/lib/format'
import { useApp } from '~/lib/store'
import { CATEGORIES, type CategoryId } from '~/lib/categories'
import { transitionName, useListMotion } from '~/lib/motion'
import { useStorage } from '~/lib/storage'

interface StorageSearch {
  category?: CategoryId
  path?: string
}

export const Route = createFileRoute('/storage')({
  component: StoragePage,
  validateSearch: (raw: Record<string, unknown>): StorageSearch => ({
    category: CATEGORIES.find((c) => c.id === raw.category)?.id,
    path: typeof raw.path === 'string' ? raw.path : undefined,
  }),
})

const MIN_ROW_BYTES = 1_000_000
const COLLAPSED_ROWS = 8
const SHARED_HINT_RATIO = 1.5

const categoryLabel = (id: CategoryId) => `category-label-${id}`
const categorySize = (id: CategoryId) => `category-size-${id}`
const folderName = (path: string) => transitionName('folder', path)
const targetKey = (target: StorageTarget) => target.id

const SECTIONS: ReadonlyArray<{
  group: StorageGroup
  category: CategoryId
  title: string
  hint: string
  nested?: boolean
}> = [
  { group: 'applications', category: 'applications', title: 'Apps', hint: 'Removed apps go to the Trash.' },
  { group: 'packages', category: 'developer', title: 'Package managers', hint: 'Downloads kept in case you need them again.' },
  { group: 'mobile', category: 'developer', title: 'Xcode and simulators', hint: 'Build output and device images.' },
  { group: 'documents', category: 'documents', title: 'Folders', hint: 'Open a folder to see what fills it.' },
  { group: 'projects', category: 'documents', title: 'Project build folders', hint: 'Dependencies and build output inside those folders.', nested: true },
  { group: 'icloud', category: 'icloud', title: 'iCloud Drive', hint: 'Deleting here deletes on all your devices.' },
  { group: 'messages', category: 'messages', title: 'Messages', hint: 'Clear space from inside Messages.' },
  { group: 'photos', category: 'photos', title: 'Photos', hint: 'Clear space from inside Photos.' },
  { group: 'apps', category: 'system', title: 'App caches and logs', hint: 'Most of what macOS calls System Data.' },
  { group: 'hidden', category: 'system', title: 'Hidden system files', hint: "Folders Finder and System Settings don't show." },
]

const OWNING_APP: Partial<Record<StorageGroup, { name: string; path: string }>> = {
  messages: { name: 'Messages', path: '/System/Applications/Messages.app' },
  photos: { name: 'Photos', path: '/System/Applications/Photos.app' },
}

const SAFETY: Record<StorageSafety, { label: string; tone: 'live' | 'held' | 'neutral' }> = {
  safe: { label: 'Safe', tone: 'live' },
  review: { label: 'Review', tone: 'held' },
  keep: { label: 'Keep', tone: 'neutral' },
}

/** The honest size of a row: what it frees, or what it occupies if it can't be removed. */
const shownBytes = (target: StorageTarget, measurement: Measurement | undefined) =>
  target.disposal === 'none'
    ? (measurement?.apparentBytes ?? 0)
    : (measurement?.reclaimableBytes ?? 0)

function StoragePage() {
  const storage = useStorage()
  const { disk, targets, browsed, measurements, measuredCount, scanning, cleaning, error } =
    storage
  const { selected, scan, browse, setSelected } = storage
  const { category, path } = Route.useSearch()
  const { entries, home } = useApp()
  const [confirming, setConfirming] = useState(false)
  const [cleanFrom, setCleanFrom] = useState({ x: 0, y: 0 })
  const toast = useToast()
  const failed = (title: string) => (e: unknown) =>
    toast.add({ title, description: errorMessage(e), type: 'error' })
  const askAccess = storage.access === 'missing' && !storage.limited && !storage.needsScan

  useEffect(() => {
    if (storage.needsScan && !scanning) void scan()
  }, [storage.needsScan, scanning, scan])

  useEffect(() => {
    if (storage.access !== 'missing') return
    const check = () => void storage.checkAccess()
    const timer = setInterval(check, 2000)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [storage.access, storage.checkAccess])

  useEffect(() => {
    if (path && !browsed.has(path)) void browse(path)
  }, [path, browsed, browse])

  const known = useMemo(
    () => [...targets, ...[...browsed.values()].flat()],
    [targets, browsed],
  )

  const size = (t: StorageTarget) => shownBytes(t, measurements.get(t.id))

  const inUse = useMemo(() => {
    const roots = entries.flatMap((e) => e.process.project?.path ?? [])
    const holds = (t: StorageTarget, root: string) =>
      t.path === root || t.path.startsWith(`${root}/`) || root.startsWith(`${t.path}/`)
    return new Set(
      known
        .filter((t) => t.disposal !== 'none' && t.group !== 'applications')
        .filter((t) => roots.some((root) => holds(t, root)))
        .map((t) => t.id),
    )
  }, [entries, known])

  const selectable = (t: StorageTarget) =>
    t.disposal !== 'none' && !inUse.has(t.id) && size(t) > 0

  const chosen = [...new Map(known.map((t) => [t.id, t])).values()].filter(
    (t) => selected.has(t.id) && selectable(t),
  )
  const chosenBytes = chosen.reduce((sum, t) => sum + size(t), 0)
  const safeTargets = targets.filter((t) => t.safety === 'safe' && selectable(t))
  const safeBytes = safeTargets.reduce((sum, t) => sum + size(t), 0)
  const unreadable = [...measurements.values()].reduce((sum, m) => sum + m.unreadable, 0)

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    setSelected(next)
  }

  const runClean = async () => {
    setConfirming(false)
    const toTrash = chosen.filter((t) => t.disposal === 'trash').length
    const results = await storage.clean(chosen)
    const failures = [...results.entries()].flatMap(([id, r]) =>
      r instanceof Error
        ? [`${known.find((t) => t.id === id)?.label}: ${r.message}`]
        : r.failures,
    )
    const protectedItems = [...results.values()].reduce(
      (sum, r) => sum + (r instanceof Error ? 0 : r.protectedItems),
      0,
    )
    const description = () => {
      if (toTrash > 0) return 'Empty the Trash in Finder to get the space back.'
      if (protectedItems > 0)
        return `macOS protects ${protectedItems} of the files, so they were left in place.`
      return 'Free space on the disk is updated above.'
    }
    toast.add(
      failures.length === 0
        ? {
            title: `Cleaned ${chosen.length} ${chosen.length === 1 ? 'item' : 'items'}`,
            description: description(),
            type: 'success',
          }
        : {
            title: `${failures.length} ${failures.length === 1 ? 'item' : 'items'} couldn't be removed`,
            description: failures[0],
            type: 'error',
            timeout: 10000,
          },
    )
  }

  const totals = categoryTotals(disk, targets, measurements)
  const notes = categoryNotes(targets, measurements, scanning, storage.limited)

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[880px] px-6 pb-8 pt-5">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-[12px] text-danger">
              <AlertTriangle size={13} className="mt-px shrink-0" />
              <span className="selectable">{error}</span>
            </div>
          )}

          {storage.limited && (
            <div className="mb-4 flex items-center justify-between gap-4 rounded-md border border-held/20 bg-held/10 px-3 py-2 text-[11.5px] leading-relaxed text-held">
              <span>
                Scanned without Full Disk Access, so Desktop, Documents, Downloads, iCloud
                Drive, Messages and Photos are left out.
              </span>
              <button
                type="button"
                className="btn shrink-0 py-1"
                onClick={() => void openPrivacySettings().catch(failed('Could not open System Settings'))}
              >
                Allow access
              </button>
            </div>
          )}

          {unreadable > 0 && !scanning && !storage.limited && (
            <p className="mb-4 rounded-md border border-held/20 bg-held/10 px-3 py-2 text-[11.5px] leading-relaxed text-held">
              macOS kept {unreadable.toLocaleString()} items private, so some sizes are
              low. Give marè Full Disk Access in System Settings › Privacy &amp;
              Security to see them.
            </p>
          )}

          {storage.access === 'checking' ? null : askAccess ? (
            <AccessRequest
              onOpen={() =>
                void openPrivacySettings().catch(failed('Could not open System Settings'))
              }
              onSkip={storage.scanWithoutAccess}
            />
          ) : category ? (
            <CategoryView
              category={category}
              path={path}
              total={notes[category] ?? formatBytes(totals[category])}
              rowProps={{
                measurements,
                selected,
                inUse,
                home,
                selectable,
                onToggle: toggle,
              }}
            />
          ) : (
            <Overview
              disk={disk}
              totals={totals}
              notes={notes}
              selectedBytes={chosenBytes}
              scanning={scanning}
              onScan={() => void scan()}
            />
          )}
        </div>
      </div>

      {storage.access !== 'checking' && !askAccess && (
        <footer className="flex h-12 shrink-0 items-center gap-3 border-t border-line px-6">
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
              className="btn btn-primary"
              disabled={chosen.length === 0 || cleaning || scanning}
              onClick={(e) => {
                const box = e.currentTarget.getBoundingClientRect()
                setCleanFrom({
                  x: box.left + box.width / 2 - window.innerWidth / 2,
                  y: box.top + box.height / 2 - window.innerHeight / 2,
                })
                setConfirming(true)
              }}
            >
              {cleaning ? 'Cleaning…' : `Clean ${formatBytes(chosenBytes)}`}
            </button>
          </div>
        </footer>
      )}

      <ConfirmClean
        open={confirming}
        targets={chosen}
        bytes={chosenBytes}
        sizeOf={size}
        from={cleanFrom}
        onClose={() => setConfirming(false)}
        onConfirm={() => void runClean()}
      />
    </div>
  )
}

/**
 * System Data is whatever nothing else claims, the same way macOS defines it, so swap,
 * snapshots and folders we can't read are all in there rather than unaccounted for.
 */
function categoryTotals(
  disk: DiskUsage | null,
  targets: StorageTarget[],
  measurements: ReadonlyMap<string, Measurement>,
): Record<CategoryId, number> {
  const sum = (category: CategoryId) =>
    SECTIONS.filter((s) => s.category === category && !s.nested)
      .flatMap((s) => targets.filter((t) => t.group === s.group))
      .reduce((total, t) => total + shownBytes(t, measurements.get(t.id)), 0)

  const known = {
    applications: sum('applications'),
    developer: sum('developer'),
    documents: sum('documents'),
    icloud: sum('icloud'),
    messages: sum('messages'),
    photos: sum('photos'),
    macos: disk?.systemBytes ?? 0,
  }
  const used = disk ? disk.totalBytes - disk.freeBytes : 0
  const claimed = Object.values(known).reduce((a, b) => a + b, 0)
  return { ...known, system: Math.max(used - claimed, sum('system')) }
}

/** What to show instead of a number that isn't known yet or can't be known at all. */
function categoryNotes(
  targets: StorageTarget[],
  measurements: ReadonlyMap<string, Measurement>,
  scanning: boolean,
  limited: boolean,
): Partial<Record<CategoryId, string>> {
  const notes: Partial<Record<CategoryId, string>> = {}
  if (limited) {
    notes.icloud = 'No access'
    notes.messages = 'No access'
    notes.photos = 'No access'
  }
  for (const { category, group } of SECTIONS) {
    const rows = targets.filter((t) => t.group === group)
    const denied = rows.some((t) => {
      const m = measurements.get(t.id)
      return m && m.apparentBytes === 0 && m.unreadable > 0
    })
    if (denied) notes[category] = 'No access'
    if (scanning && rows.some((t) => !measurements.has(t.id))) notes[category] = 'Calculating…'
  }
  if (scanning) notes.system = 'Calculating…'
  return notes
}

function Overview({
  disk,
  totals,
  notes,
  selectedBytes,
  scanning,
  onScan,
}: {
  disk: DiskUsage | null
  totals: Record<CategoryId, number>
  notes: Partial<Record<CategoryId, string>>
  selectedBytes: number
  scanning: boolean
  onScan: () => void
}) {
  const percent = (bytes: number) => (disk ? (bytes / disk.totalBytes) * 100 : 0)

  return (
    <>
      <section className="sticky top-0 z-10 -mt-5 bg-surface pt-5 pb-6">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight text-ink">Storage</h1>
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
          aria-label="Disk usage by category"
          className="flex h-2.5 gap-px overflow-hidden rounded-full bg-surface-3"
        >
          {CATEGORIES.map((c) => (
            <div
              key={c.id}
              className={cx(c.bar, 'transition-[width] duration-300')}
              style={{ width: `${percent(totals[c.id])}%` }}
            />
          ))}
        </div>
        {selectedBytes > 0 && (
          <p className="mt-2 text-[11.5px] text-live">
            {formatBytes(selectedBytes)} selected
          </p>
        )}
      </section>

      <div className="divide-y divide-line-soft rounded-card border border-line bg-surface">
        {CATEGORIES.map((c) => {
          const Icon = c.icon
          const content = (
            <>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-ink-dim">
                <Icon size={14} />
              </span>
              <span
                className="text-[12.5px] font-medium text-ink"
                style={{ viewTransitionName: categoryLabel(c.id) }}
              >
                {c.label}
              </span>
              <span className={cx('ml-auto size-[7px] rounded-full', c.bar)} />
              <span className="w-[86px] text-right text-[12.5px] tabular-nums text-ink-dim">
                <span style={{ viewTransitionName: categorySize(c.id) }}>
                  {notes[c.id] ?? formatBytes(totals[c.id])}
                </span>
              </span>
            </>
          )
          if (c.id === 'macos') {
            return (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3 pr-[41px]">
                {content}
              </div>
            )
          }
          return (
            <Link
              key={c.id}
              to="/storage"
              search={{ category: c.id }}
              viewTransition
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
            >
              {content}
              <ChevronRight size={13} className="shrink-0 text-ink-faint" />
            </Link>
          )
        })}
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-faint">
        These totals won't match System Settings exactly. Each size here is what deleting
        would actually free.
      </p>
    </>
  )
}

function AccessRequest({ onOpen, onSkip }: { onOpen: () => void; onSkip: () => void }) {
  return (
    <section className="mx-auto flex max-w-[460px] flex-col items-center pt-16 text-center">
      <span className="mb-5 flex size-12 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink-dim">
        <ShieldCheck size={20} />
      </span>
      <h1 className="text-[20px] font-semibold tracking-tight text-ink">
        Give marè access to your disk
      </h1>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-faint">
        Storage reads every folder to find what's taking up space. Without Full Disk Access,
        macOS asks about each folder separately and keeps Messages and Photos hidden.
      </p>
      <ol className="mt-6 w-full list-decimal space-y-2 rounded-card border border-line bg-surface-2 py-4 pl-9 pr-4 text-left text-[12.5px] leading-relaxed text-ink-dim">
        <li>Open Full Disk Access in System Settings.</li>
        <li>Turn on marè. If it isn't listed, click + and choose marè from Applications.</li>
        <li>If macOS offers Quit &amp; Reopen, choose it. The scan then starts on its own.</li>
      </ol>
      <div className="mt-6 flex gap-2">
        <button type="button" className="btn btn-primary" onClick={onOpen}>
          Open System Settings
        </button>
        <button type="button" className="btn" onClick={onSkip}>
          Scan without access
        </button>
      </div>
      <p className="mt-3 text-[11.5px] text-ink-faint">
        Scanning without access skips Desktop, Documents, Downloads, iCloud Drive, Messages
        and Photos.
      </p>
    </section>
  )
}

interface RowProps {
  measurements: ReadonlyMap<string, Measurement>
  selected: ReadonlySet<string>
  inUse: ReadonlySet<string>
  home: string
  selectable: (target: StorageTarget) => boolean
  onToggle: (id: string, on: boolean) => void
}

function CategoryView({
  category,
  path,
  total,
  rowProps,
}: {
  category: CategoryId
  path: string | undefined
  total: string
  rowProps: RowProps
}) {
  const { targets, browsed } = useStorage()
  const navigate = useNavigate({ from: Route.fullPath })
  const info = CATEGORIES.find((c) => c.id === category)

  const open = (next: string) =>
    void navigate({ search: { category, path: next }, viewTransition: true })

  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => title.current?.focus({ preventScroll: true }), [category, path])

  const backTo = () => {
    if (!path) return {}
    const isRoot = targets.some((t) => t.path === path)
    return isRoot
      ? { category }
      : { category, path: path.slice(0, path.lastIndexOf('/')) }
  }

  const items = path ? browsed.get(path) : undefined

  return (
    <>
      <div className="sticky top-0 z-10 -mt-5 bg-surface pt-5 pb-5">
        <Link
          to="/storage"
          search={backTo()}
          viewTransition
          className="mb-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-ink-faint transition-colors hover:text-ink-dim"
        >
          <ChevronLeft size={12} /> Back
        </Link>
        <div className="flex items-baseline justify-between gap-4">
          <h1
            ref={title}
            tabIndex={-1}
            className="min-w-0 truncate text-[20px] font-semibold tracking-tight text-ink outline-none"
            style={{ viewTransitionName: path ? folderName(path) : categoryLabel(category) }}
          >
            {path ? basename(path) : info?.label}
          </h1>
          {!path && (
            <span
              className="shrink-0 text-[13px] font-medium tabular-nums text-ink-dim"
              style={{ viewTransitionName: categorySize(category) }}
            >
              {total}
            </span>
          )}
        </div>
      </div>

      {path ? (
        <GroupSection
          key={path}
          title="Largest items"
          hint="Moved to the Trash, so you can put them back."
          targets={items ?? []}
          onOpen={open}
          loading={items === undefined}
          {...rowProps}
        />
      ) : (
        SECTIONS.filter((s) => s.category === category).map((section) => (
          <GroupSection
            key={section.group}
            title={section.title}
            hint={section.hint}
            targets={targets.filter((t) => t.group === section.group)}
            onOpen={open}
            loading={false}
            {...rowProps}
          />
        ))
      )}
    </>
  )
}

function GroupSection({
  title,
  hint,
  targets,
  onOpen,
  loading,
  ...rowProps
}: RowProps & {
  title: string
  hint: string
  targets: StorageTarget[]
  onOpen: (path: string) => void
  loading: boolean
}) {
  const { measurements, selected, inUse, home, selectable, onToggle } = rowProps
  const [expanded, setExpanded] = useState(false)

  const rows = targets
    .filter((t) => (measurements.get(t.id)?.apparentBytes ?? 0) >= MIN_ROW_BYTES)
    .sort(
      (a, b) =>
        shownBytes(b, measurements.get(b.id)) - shownBytes(a, measurements.get(a.id)),
    )
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS)
  const motion = useListMotion(shown, targetKey)

  if (loading) {
    return <Empty icon={<HardDrive size={24} />} title="Looking inside…" />
  }
  if (rows.length === 0 && targets.length > 0) {
    return (
      <Empty
        icon={<HardDrive size={24} />}
        title="Nothing large here"
        body="Everything in this folder is under 1 MB."
      />
    )
  }
  if (rows.length === 0) return null

  const total = rows.reduce((sum, t) => sum + shownBytes(t, measurements.get(t.id)), 0)

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
      <div
        ref={motion.ref}
        className="relative divide-y divide-line-soft rounded-card border border-line bg-surface"
      >
        {motion.items.map(({ item: target, leaving }) => (
          <Row
            key={target.id}
            target={target}
            leaving={leaving}
            measurement={measurements.get(target.id)}
            checked={selected.has(target.id)}
            enabled={selectable(target)}
            running={inUse.has(target.id)}
            home={home}
            onToggle={(on) => onToggle(target.id, on)}
            onOpen={onOpen}
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
  leaving,
  measurement,
  checked,
  enabled,
  running,
  home,
  onToggle,
  onOpen,
}: {
  target: StorageTarget
  leaving: boolean
  measurement: Measurement | undefined
  checked: boolean
  enabled: boolean
  running: boolean
  home: string
  onToggle: (on: boolean) => void
  onOpen: (path: string) => void
}) {
  const toast = useToast()
  const apparent = measurement?.apparentBytes ?? 0
  const bytes = shownBytes(target, measurement)
  const shared = target.disposal !== 'none' && apparent > bytes * SHARED_HINT_RATIO
  const owner = OWNING_APP[target.group]

  const failed = (title: string) => (e: unknown) =>
    toast.add({ title, description: errorMessage(e), type: 'error' })

  const name = (
    <>
      <span
        className="truncate text-[12.5px] font-medium text-ink"
        style={{
          viewTransitionName:
            target.browsable && !leaving ? folderName(target.path) : undefined,
        }}
      >
        {target.label}
      </span>
      {target.disposal === 'trash' ? (
        <Chip tone="info">Trash</Chip>
      ) : (
        <Chip tone={SAFETY[target.safety].tone}>{SAFETY[target.safety].label}</Chip>
      )}
      {running && <Chip tone="info">Running</Chip>}
    </>
  )

  return (
    <div
      data-motion-key={target.id}
      data-leaving={leaving || undefined}
      inert={leaving}
      className="flex items-center gap-3 px-4 py-2.5"
    >
      {target.disposal !== 'none' && (
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
      )}

      <div className="min-w-0 flex-1">
        {target.browsable ? (
          <button
            type="button"
            onClick={() => onOpen(target.path)}
            className="flex min-w-0 max-w-full items-center gap-2 text-left hover:underline"
          >
            {name}
          </button>
        ) : (
          <div className="flex min-w-0 items-center gap-2">{name}</div>
        )}
        <p className="mt-0.5 truncate text-[11.5px] text-ink-faint">
          {target.modifiedMs !== null && `${formatAge(target.modifiedMs)} · `}
          {target.detail}
        </p>
      </div>

      {owner && (
        <button
          type="button"
          className="btn"
          onClick={() => void openPath(owner.path).catch(failed(`Could not open ${owner.name}`))}
        >
          Open {owner.name}
        </button>
      )}

      <Tip content={`Show ${tildify(target.path, home)} in Finder`}>
        <button
          type="button"
          onClick={() =>
            void revealInFinder(target.path).catch(failed('Could not open Finder'))
          }
          aria-label={`Show ${target.label} in Finder`}
          className="btn btn-ghost px-1.5"
        >
          <FolderSearch size={13} />
        </button>
      </Tip>

      <Tip
        content={
          shared
            ? `Takes up ${formatBytes(apparent)} on paper, but most of it shares disk blocks with other files, so deleting it frees ${formatBytes(bytes)}.`
            : null
        }
      >
        <span
          className={cx(
            'w-[68px] shrink-0 text-right text-[12.5px] tabular-nums',
            bytes > 0 ? 'font-medium text-ink' : 'text-ink-faint',
          )}
        >
          {formatBytes(bytes)}
        </span>
      </Tip>

      {target.browsable && (
        <button
          type="button"
          onClick={() => onOpen(target.path)}
          aria-label={`Open ${target.label}`}
          className="shrink-0 text-ink-faint hover:text-ink-dim"
        >
          <ChevronRight size={13} />
        </button>
      )}
    </div>
  )
}

function ConfirmClean({
  open,
  targets,
  bytes,
  sizeOf,
  from,
  onClose,
  onConfirm,
}: {
  open: boolean
  targets: StorageTarget[]
  bytes: number
  sizeOf: (target: StorageTarget) => number
  from: { x: number; y: number }
  onClose: () => void
  onConfirm: () => void
}) {
  const toDelete = targets.filter((t) => t.disposal === 'delete')
  const toTrash = targets.filter((t) => t.disposal === 'trash')
  const review = toDelete.some((t) => t.safety === 'review')
  const icloud = toTrash.some((t) => t.group === 'icloud')

  const mixed = toDelete.length > 0 && toTrash.length > 0
  const wording = () => {
    if (mixed) return { title: `Clean ${formatBytes(bytes)}?`, action: 'Clean' }
    return toTrash.length > 0
      ? { title: `Move ${formatBytes(bytes)} to the Trash?`, action: 'Move to Trash' }
      : { title: `Permanently delete ${formatBytes(bytes)}?`, action: 'Delete permanently' }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <AlertDialog.Popup
          className="popup grow-from fixed left-1/2 top-1/2 z-50 w-[460px] -translate-x-1/2 -translate-y-1/2 p-5"
          style={{ '--from-x': `${from.x}px`, '--from-y': `${from.y}px` } as React.CSSProperties}
        >
          <AlertDialog.Title className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <HardDrive size={15} className="text-ink-faint" />
            {wording().title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
            {toDelete.length > 0 &&
              'Items without a Trash tag are deleted, not moved to the Trash. They rebuild themselves. '}
            {review && "Check items marked Review first. They won't rebuild on their own. "}
            {toTrash.length > 0 &&
              'Items tagged Trash can be put back. Their space returns when you empty the Trash. '}
            {icloud && 'iCloud items are removed from all your devices.'}
          </AlertDialog.Description>

          <ul className="mt-3 max-h-56 divide-y divide-line-soft overflow-y-auto rounded-md border border-line bg-canvas">
            {targets.map((target) => (
              <li key={target.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[11.5px]">
                <span className="min-w-0 flex-1 truncate text-ink-dim">{target.label}</span>
                {target.disposal === 'trash' && <Chip tone="info">Trash</Chip>}
                {target.disposal === 'delete' && target.safety === 'review' && (
                  <Chip tone="held">Review</Chip>
                )}
                <span className="shrink-0 tabular-nums text-ink-faint">
                  {formatBytes(sizeOf(target))}
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
              {wording().action}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
