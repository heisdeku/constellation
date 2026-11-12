import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  cleanTarget,
  diskUsage,
  errorMessage,
  measureTarget,
  storageChildren,
  storageTargets,
  type CleanResult,
  type DiskUsage,
  type Measurement,
  type StorageTarget,
} from './api'

/** Walks are disk-bound; past this they slow each other down and the Mac with them. */
const MEASURE_CONCURRENCY = 6

interface StorageState {
  disk: DiskUsage | null
  targets: StorageTarget[]
  /** What's inside each folder opened so far, keyed by its path. */
  browsed: ReadonlyMap<string, StorageTarget[]>
  measurements: ReadonlyMap<string, Measurement>
  /** Targets measured so far this scan, for the progress line. */
  measuredCount: number
  scanning: boolean
  cleaning: boolean
  error: string | null
  selected: ReadonlySet<string>
  setSelected: (ids: ReadonlySet<string>) => void
  scan: () => Promise<void>
  browse: (path: string) => Promise<void>
  clean: (targets: StorageTarget[]) => Promise<Map<string, CleanResult | Error>>
}

const StorageContext = createContext<StorageState | null>(null)

export function StorageProvider({ children }: { children: React.ReactNode }) {
  const [disk, setDisk] = useState<DiskUsage | null>(null)
  const [targets, setTargets] = useState<StorageTarget[]>([])
  const [browsed, setBrowsed] = useState<Map<string, StorageTarget[]>>(new Map())
  const [measurements, setMeasurements] = useState<Map<string, Measurement>>(new Map())
  const [measuredCount, setMeasuredCount] = useState(0)
  const [scanning, setScanning] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const inFlight = useRef(false)

  // Cheap enough to read up front, so the sidebar can show free space before a scan.
  useEffect(() => {
    diskUsage().then(setDisk, (e) => setError(errorMessage(e)))
  }, [])

  const measure = useCallback(async (id: string) => {
    const next = await measureTarget(id)
    setMeasurements((m) => new Map(m).set(id, next))
  }, [])

  const measureAll = useCallback(
    async (ids: string[]) => {
      const queue = [...ids]
      const worker = async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
          // One unreadable folder shouldn't cost the rest of the scan.
          await measure(id).catch((e) => setError(errorMessage(e)))
          setMeasuredCount((n) => n + 1)
        }
      }
      await Promise.all(Array.from({ length: MEASURE_CONCURRENCY }, worker))
    },
    [measure],
  )

  const browse = useCallback(
    async (path: string) => {
      try {
        const found = await storageChildren(path)
        setBrowsed((b) => new Map(b).set(path, found))
        await measureAll(found.map((t) => t.id))
      } catch (e) {
        setError(errorMessage(e))
      }
    },
    [measureAll],
  )

  const scan = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setScanning(true)
    setError(null)
    setMeasuredCount(0)
    try {
      setDisk(await diskUsage())
      const found = await storageTargets()
      setTargets(found)
      setBrowsed(new Map())
      await measureAll(found.map((t) => t.id))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      inFlight.current = false
      setScanning(false)
    }
  }, [measureAll])

  const clean = useCallback(
    async (chosen: StorageTarget[]) => {
      setCleaning(true)
      const results = new Map<string, CleanResult | Error>()
      for (const target of chosen) {
        try {
          results.set(target.id, await cleanTarget(target.id))
          await measure(target.id)
        } catch (e) {
          results.set(target.id, new Error(errorMessage(e)))
        }
      }
      setSelected(new Set())
      setCleaning(false)
      diskUsage().then(setDisk, (e) => setError(errorMessage(e)))
      const cleaned = new Set(chosen.map((t) => t.id))
      for (const [path, items] of browsed) {
        if (items.some((t) => cleaned.has(t.id))) void browse(path)
      }
      return results
    },
    [measure, browsed, browse],
  )

  const value = useMemo<StorageState>(
    () => ({
      disk,
      targets,
      browsed,
      measurements,
      measuredCount,
      scanning,
      cleaning,
      error,
      selected,
      setSelected,
      scan,
      browse,
      clean,
    }),
    [
      disk,
      targets,
      browsed,
      measurements,
      measuredCount,
      scanning,
      cleaning,
      error,
      selected,
      scan,
      browse,
      clean,
    ],
  )

  return <StorageContext.Provider value={value}>{children}</StorageContext.Provider>
}

export function useStorage(): StorageState {
  const ctx = useContext(StorageContext)
  if (!ctx) throw new Error('useStorage must be used inside <StorageProvider>')
  return ctx
}
