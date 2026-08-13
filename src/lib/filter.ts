import type { PortEntry } from './api'
import { folderFor } from './format'

export type ProtoFilter = 'all' | 'tcp' | 'udp'
export type ScopeFilter = 'all' | 'loopback' | 'lan'
export type SortKey = 'port' | 'process' | 'project' | 'pid' | 'cpu'
export type SortDir = 'asc' | 'desc'

export interface PortsSearch {
  q: string
  proto: ProtoFilter
  scope: ScopeFilter
  sort: SortKey
  dir: SortDir
  sel?: string
}

export const DEFAULT_SEARCH: PortsSearch = {
  q: '',
  proto: 'all',
  scope: 'all',
  sort: 'port',
  dir: 'asc',
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

/** TanStack Router hands us untyped search params; coerce them to a known shape. */
export function parseSearch(raw: Record<string, unknown>): PortsSearch {
  return {
    q: typeof raw.q === 'string' ? raw.q : '',
    proto: oneOf(raw.proto, ['all', 'tcp', 'udp'] as const, 'all'),
    scope: oneOf(raw.scope, ['all', 'loopback', 'lan'] as const, 'all'),
    sort: oneOf(raw.sort, ['port', 'process', 'project', 'pid', 'cpu'] as const, 'port'),
    dir: oneOf(raw.dir, ['asc', 'desc'] as const, 'asc'),
    sel: typeof raw.sel === 'string' && raw.sel ? raw.sel : undefined,
  }
}

/** Everything a query can match against, lowercased once per entry. */
function haystack(entry: PortEntry): string {
  const folder = folderFor(entry)
  return [
    entry.port,
    entry.protocol,
    entry.pid,
    entry.process.name,
    entry.process.command,
    entry.process.user,
    folder?.label,
    folder?.path,
    entry.docker?.name,
    entry.docker?.image,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function filterAndSort(
  entries: PortEntry[],
  search: PortsSearch,
  hideSystem: boolean,
): PortEntry[] {
  const q = search.q.trim().toLowerCase()
  // A bare number should match the port itself, not any command that mentions it.
  const numeric = /^\d+$/.test(q) ? Number(q) : null

  const filtered = entries.filter((e) => {
    if (hideSystem && !e.process.ownedByMe) return false
    if (search.proto !== 'all' && e.protocol.toLowerCase() !== search.proto) return false
    if (search.scope !== 'all' && e.scope !== search.scope) return false
    if (!q) return true
    if (numeric !== null && (e.port === numeric || e.pid === numeric)) return true
    return haystack(e).includes(q)
  })

  const factor = search.dir === 'asc' ? 1 : -1
  const byPort = (a: PortEntry, b: PortEntry) => a.port - b.port

  return filtered.sort((a, b) => {
    switch (search.sort) {
      case 'process':
        return factor * a.process.name.localeCompare(b.process.name) || byPort(a, b)
      case 'project': {
        const an = folderFor(a)?.label ?? ''
        const bn = folderFor(b)?.label ?? ''
        // Entries with no folder sort last regardless of direction.
        if (!an !== !bn) return an ? -1 : 1
        return factor * an.localeCompare(bn) || byPort(a, b)
      }
      case 'pid':
        return factor * (a.pid - b.pid)
      case 'cpu':
        return factor * (a.process.cpu - b.process.cpu) || byPort(a, b)
      case 'port':
      default:
        return factor * byPort(a, b) || a.protocol.localeCompare(b.protocol)
    }
  })
}
