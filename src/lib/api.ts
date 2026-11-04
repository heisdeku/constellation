import { invoke } from '@tauri-apps/api/core'

export interface ProjectInfo {
  path: string
  name: string
  kind: string
  marker: string
}

export interface ProcessInfo {
  pid: number
  ppid: number
  name: string
  exe: string
  command: string
  user: string
  state: string
  paused: boolean
  cpu: number
  mem: number
  uptimeSeconds: number
  cwd: string | null
  cwdExists: boolean
  project: ProjectInfo | null
  appBundle: string | null
  ownedByMe: boolean
  protected: boolean
}

export interface DockerInfo {
  containerId: string
  name: string
  image: string
}

export type PortScope = 'loopback' | 'lan' | 'specific'

export interface PortEntry {
  id: string
  protocol: 'TCP' | 'UDP'
  port: number
  addresses: string[]
  ipVersions: string[]
  scope: PortScope
  pid: number
  process: ProcessInfo
  docker: DockerInfo | null
}

export interface ScanResult {
  entries: PortEntry[]
  scannedAt: number
  warnings: string[]
}

export interface ControlResult {
  exited: boolean
  escalated: boolean
  process: ProcessInfo | null
  message: string
}

export type StorageSafety = 'safe' | 'review' | 'keep'

export type StorageDisposal = 'delete' | 'trash' | 'none'

export type StorageGroup =
  | 'packages'
  | 'mobile'
  | 'apps'
  | 'hidden'
  | 'projects'
  | 'applications'
  | 'documents'
  | 'icloud'
  | 'messages'
  | 'photos'

export interface StorageTarget {
  id: string
  group: StorageGroup
  label: string
  detail: string
  path: string
  safety: StorageSafety
  disposal: StorageDisposal
  browsable: boolean
  modifiedMs: number | null
}

export interface Measurement {
  apparentBytes: number
  reclaimableBytes: number
  unreadable: number
}

export interface DiskUsage {
  totalBytes: number
  freeBytes: number
  systemBytes: number
}

export interface CleanResult {
  removed: number
  protectedItems: number
  failures: string[]
}

/** The Tauri webview injects this; a plain browser never will. */
export const isDesktopShell = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const NO_SHELL =
  'System Manager is running as a plain web page, so it has no access to your ' +
  'Mac. Stop `pnpm dev` and run `pnpm app` instead — that launches the desktop ' +
  'app, which is what reads your ports and disk.'

/**
 * Every backend call goes through here so that running the UI outside the desktop
 * shell reports what's wrong instead of throwing `undefined is not an object`.
 */
function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktopShell()) return Promise.reject(new Error(NO_SHELL))
  return invoke<T>(cmd, args)
}

export const scanPorts = (includeUdp: boolean) =>
  call<ScanResult>('scan_ports', { includeUdp })

export const pauseProcess = (pid: number, expectedName: string) =>
  call<ControlResult>('pause_process', { pid, expectedName })

export const resumeProcess = (pid: number, expectedName: string) =>
  call<ControlResult>('resume_process', { pid, expectedName })

export const stopProcess = (
  pid: number,
  expectedName: string,
  force: boolean,
  graceMs: number,
) => call<ControlResult>('stop_process', { pid, expectedName, force, graceMs })

export const revealInFinder = (path: string) =>
  call<void>('reveal_in_finder', { path })

export const openPath = (path: string) => call<void>('open_path', { path })

export const openInTerminal = (path: string) =>
  call<void>('open_in_terminal', { path })

export const openInEditor = (path: string) =>
  call<string>('open_in_editor', { path })

export const diskUsage = () => call<DiskUsage>('disk_usage')

export const storageTargets = () => call<StorageTarget[]>('storage_targets')

export const storageChildren = (path: string) =>
  call<StorageTarget[]>('storage_children', { path })

export const measureTarget = (id: string) =>
  call<Measurement>('measure_target', { id })

export const cleanTarget = (id: string) =>
  call<CleanResult>('clean_target', { id })

/** Tauri rejects with a plain string; normalise it for display. */
export function errorMessage(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  return String(e)
}
