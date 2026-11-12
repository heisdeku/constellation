import type { PortEntry, PortScope } from './api'

const WELL_KNOWN: Record<number, string> = {
  22: 'SSH',
  25: 'SMTP',
  53: 'DNS',
  80: 'HTTP',
  443: 'HTTPS',
  445: 'SMB',
  631: 'CUPS',
  1420: 'Tauri dev',
  3000: 'Dev server',
  3001: 'Dev server',
  3306: 'MySQL',
  4000: 'Dev server',
  4200: 'Angular',
  5000: 'AirPlay / Flask',
  5173: 'Vite',
  5432: 'PostgreSQL',
  5672: 'RabbitMQ',
  6379: 'Redis',
  7000: 'AirPlay',
  8000: 'Dev server',
  8080: 'HTTP alt',
  8081: 'Metro',
  8443: 'HTTPS alt',
  9000: 'Dev server',
  9200: 'Elasticsearch',
  9229: 'Node inspector',
  11434: 'Ollama',
  19000: 'Expo',
  19001: 'Expo',
  27017: 'MongoDB',
}

export const wellKnownName = (port: number): string | null =>
  WELL_KNOWN[port] ?? null

export const SCOPE_LABEL: Record<PortScope, string> = {
  loopback: 'Local only',
  lan: 'On your network',
  specific: 'Bound address',
}

export const SCOPE_HINT: Record<PortScope, string> = {
  loopback: 'Only this Mac can reach it.',
  lan: 'Any device on your network can reach it.',
  specific: 'Reachable at one specific address.',
}

export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = -1
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value.toFixed(value >= 100 || unit < 2 ? 0 : 1)} ${units[unit]}`
}

export function formatAge(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  if (days < 1) return 'Changed today'
  if (days < 60) return `Changed ${days}d ago`
  return `Changed ${Math.floor(days / 30)}mo ago`
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Collapse `$HOME` to `~` the way a shell prompt would. */
export function tildify(path: string, home: string): string {
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

export interface FolderRef {
  path: string
  label: string
  kind: 'project' | 'cwd' | 'app'
  missing: boolean
}

/** The best folder to link to for an entry, and what it represents. */
export function folderFor(entry: PortEntry): FolderRef | null {
  const p = entry.process
  if (p.project)
    return { path: p.project.path, label: p.project.name, kind: 'project', missing: false }
  if (p.cwd)
    return { path: p.cwd, label: basename(p.cwd), kind: 'cwd', missing: p.cwdExists === false }
  if (p.appBundle)
    return { path: p.appBundle, label: basename(p.appBundle), kind: 'app', missing: false }
  return null
}

export const basename = (path: string): string =>
  path.split('/').filter(Boolean).pop() ?? path

/** Trim the executable path off the front of a command line — the args are the interesting part. */
export function commandArgs(command: string, exe: string): string {
  if (exe && command.startsWith(exe)) return command.slice(exe.length).trim()
  const space = command.indexOf(' ')
  return space === -1 ? '' : command.slice(space + 1)
}
