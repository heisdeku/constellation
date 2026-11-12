import {
  AppWindow,
  Cloud,
  Ellipsis,
  FileText,
  Hammer,
  Image,
  Laptop,
  MessageCircle,
} from 'lucide-react'

/** The same list, in the same order, as System Settings › General › Storage. */
export const CATEGORIES = [
  { id: 'applications', label: 'Applications', icon: AppWindow, bar: 'bg-info' },
  { id: 'developer', label: 'Developer', icon: Hammer, bar: 'bg-violet' },
  { id: 'documents', label: 'Documents', icon: FileText, bar: 'bg-live' },
  { id: 'icloud', label: 'iCloud Drive', icon: Cloud, bar: 'bg-held' },
  { id: 'messages', label: 'Messages', icon: MessageCircle, bar: 'bg-danger' },
  { id: 'photos', label: 'Photos', icon: Image, bar: 'bg-danger/60' },
  { id: 'macos', label: 'macOS', icon: Laptop, bar: 'bg-ink-faint' },
  { id: 'system', label: 'System Data', icon: Ellipsis, bar: 'bg-ink-faint/60' },
] as const

export type CategoryId = (typeof CATEGORIES)[number]['id']
