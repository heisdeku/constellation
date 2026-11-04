import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  cleanTarget,
  diskUsage,
  errorMessage,
  measureTarget,
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
  measurements: ReadonlyMap<string, Measurement>
  /** Targets measured so far this scan, for the progress line. */
  measuredCount: number
  scanning: boolean
  cleaning: boolean
  error: string | null
  selected: ReadonlySet<string>
  setSelected: (ids: ReadonlySet<string>) => void
  scan: () => Promise<void>
  clean: (targets: StorageTarget[]) => Promise<Map<string, CleanResult | Error>>
}

const StorageContext = createContext<StorageState | null>(null)

export function StorageProvider({ children }: { children: React.ReactNode }) {
  const [disk, setDisk] = useState<DiskUsage | null>(null)
  const [targets, setTargets] = useState<StorageTarget[]>([])
  const [measurements, setMeasurements] = useState<Map<string, Measurement>>(new Map())
  const [measuredCount, setMeasuredCount] = useState(0)
  const [scanning, setScanning] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const inFlight = useRef(false)

  const measure = useCallback(async (id: string) => {
    const next = await measureTarget(id)
    setMeasurements((m) => new Map(m).set(id, next))
  }, [])

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

      const queue = found.map((t) => t.id)
      const worker = async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
          // One unreadable folder shouldn't cost the rest of the scan.
          await measure(id).catch((e) => setError(errorMessage(e)))
          setMeasuredCount((n) => n + 1)
        }
      }
      await Promise.all(Array.from({ length: MEASURE_CONCURRENCY }, worker))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      inFlight.current = false
      setScanning(false)
    }
  }, [measure])

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
      return results
    },
    [measure],
  )

  const value = useMemo<StorageState>(
    () => ({
      disk,
      targets,
      measurements,
      measuredCount,
      scanning,
      cleaning,
      error,
      selected,
      setSelected,
      scan,
      clean,
    }),
    [disk, targets, measurements, measuredCount, scanning, cleaning, error, selected, scan, clean],
  )

  return <StorageContext.Provider value={value}>{children}</StorageContext.Provider>
}

export function useStorage(): StorageState {
  const ctx = useContext(StorageContext)
  if (!ctx) throw new Error('useStorage must be used inside <StorageProvider>')
  return ctx
}
