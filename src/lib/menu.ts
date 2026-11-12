import { useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'

export type MenuCommand = 'settings' | 'find' | 'palette' | 'ports' | 'storage' | 'rescan'

/** Runs `handler` whenever the menu bar sends `command`, always calling the latest handler. */
export function useMenu(command: MenuCommand, handler: () => void) {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => {
    const off = listen<MenuCommand>('menu', (event) => {
      if (event.payload === command) latest.current()
    })
    return () => void off.then((unlisten) => unlisten())
  }, [command])
}
