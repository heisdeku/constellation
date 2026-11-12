import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { homeDir } from '@tauri-apps/api/path'
import { errorMessage, scanPorts, type PortEntry, type ScanResult } from './api'

export interface Settings {
  /** How often to rescan, in ms. */
  refreshMs: number
  /** UDP has no listen state, so it's noisy — opt in. */
  includeUdp: boolean
  /** Hide ports owned by other users (mostly macOS system daemons). */
  hideSystem: boolean
  /** Ask before sending SIGTERM. */
  confirmStop: boolean
  /** How long to wait for a graceful exit before offering SIGKILL. */
  graceMs: number
}

export const DEFAULT_SETTINGS: Settings = {
  refreshMs: 3000,
  includeUdp: false,
  hideSystem: true,
  confirmStop: true,
  graceMs: 3000,
}

const STORAGE_KEY = 'mare.settings.v1'

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

interface AppState {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  resetSettings: () => void

  entries: PortEntry[]
  warnings: string[]
  scannedAt: number | null
  error: string | null
  /** True only for the very first load, so refreshes don't blank the table. */
  initialising: boolean
  scanning: boolean

  /** Whether live tracking is running. Paused freezes the list where it is. */
  tracking: boolean
  setTracking: (on: boolean) => void

  refresh: () => Promise<void>
  home: string
}

const AppContext = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [tracking, setTracking] = useState(true)
  const [home, setHome] = useState('')

  useEffect(() => {
    homeDir()
      .then((h) => setHome(h.replace(/\/$/, '')))
      .catch(() => setHome(''))
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }))
  }, [])

  const resetSettings = useCallback(() => setSettings(DEFAULT_SETTINGS), [])

  // A scan can outlive the settings that started it; ignore stale responses.
  const runId = useRef(0)
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    const id = ++runId.current
    setScanning(true)
    try {
      const next = await scanPorts(settings.includeUdp)
      if (id === runId.current) {
        setResult(next)
        setError(null)
      }
    } catch (e) {
      if (id === runId.current) setError(errorMessage(e))
    } finally {
      inFlight.current = false
      if (id === runId.current) setScanning(false)
    }
  }, [settings.includeUdp])

  // One scan on mount, and again whenever what we scan for changes — even while
  // tracking is paused, so the list is never stale-by-construction.
  useEffect(() => {
    void refresh()
  }, [refresh])

  // Chained timeouts rather than an interval: a slow scan should delay the next
  // one, not queue up behind it.
  useEffect(() => {
    if (!tracking) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const schedule = () => {
      timer = setTimeout(async () => {
        await refresh()
        if (!cancelled) schedule()
      }, settings.refreshMs)
    }

    schedule()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [refresh, tracking, settings.refreshMs])

  const value = useMemo<AppState>(
    () => ({
      settings,
      updateSettings,
      resetSettings,
      entries: result?.entries ?? [],
      warnings: result?.warnings ?? [],
      scannedAt: result?.scannedAt ?? null,
      error,
      initialising: result === null && error === null,
      scanning,
      tracking,
      setTracking,
      refresh,
      home,
    }),
    [
      settings,
      updateSettings,
      resetSettings,
      result,
      error,
      scanning,
      tracking,
      refresh,
      home,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}
