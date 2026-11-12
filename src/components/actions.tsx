import * as React from 'react'
import { AlertDialog } from '@base-ui-components/react/alert-dialog'
import * as api from '~/lib/api'
import type { PortEntry } from '~/lib/api'
import { useApp } from '~/lib/store'
import { useToast } from './Toaster'
import { folderFor } from '~/lib/format'

interface Actions {
  busyPid: number | null
  pause: (entry: PortEntry) => Promise<void>
  resume: (entry: PortEntry) => Promise<void>
  stop: (entry: PortEntry) => void
  reveal: (entry: PortEntry) => Promise<void>
  openTerminal: (entry: PortEntry) => Promise<void>
  openEditor: (entry: PortEntry) => Promise<void>
  copy: (text: string, what: string) => Promise<void>
}

const ActionsContext = React.createContext<Actions | null>(null)

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    el.remove()
  }
}

export function ActionsProvider({ children }: { children: React.ReactNode }) {
  const { settings, refresh } = useApp()
  const toast = useToast()
  const [busyPid, setBusyPid] = React.useState<number | null>(null)
  const [pendingStop, setPendingStop] = React.useState<PortEntry | null>(null)

  const fail = React.useCallback(
    (title: string, e: unknown) =>
      toast.add({ title, description: api.errorMessage(e), type: 'error', timeout: 8000 }),
    [toast],
  )

  const doStop = React.useCallback(
    async (entry: PortEntry, force: boolean) => {
      setBusyPid(entry.pid)
      try {
        const res = await api.stopProcess(
          entry.pid,
          entry.process.name,
          force,
          settings.graceMs,
        )
        if (res.exited) {
          toast.add({
            title: `Port ${entry.port} released`,
            description: res.message,
            type: 'success',
          })
        } else {
          toast.add({
            title: `${entry.process.name} is still running`,
            description: res.message,
            type: 'info',
            timeout: 12000,
            actionProps: {
              children: 'Force stop',
              onClick: () => void doStop(entry, true),
            },
          })
        }
      } catch (e) {
        fail(`Could not stop ${entry.process.name}`, e)
      } finally {
        setBusyPid(null)
        void refresh()
      }
    },
    [settings.graceMs, toast, fail, refresh],
  )

  const value = React.useMemo<Actions>(
    () => ({
      busyPid,

      async pause(entry) {
        setBusyPid(entry.pid)
        try {
          const res = await api.pauseProcess(entry.pid, entry.process.name)
          toast.add({
            title: `Paused ${entry.process.name}`,
            description: `It keeps port ${entry.port} until you resume it.`,
            type: 'success',
          })
          if (!res.process) void refresh()
        } catch (e) {
          fail(`Could not pause ${entry.process.name}`, e)
        } finally {
          setBusyPid(null)
          void refresh()
        }
      },

      async resume(entry) {
        setBusyPid(entry.pid)
        try {
          await api.resumeProcess(entry.pid, entry.process.name)
          toast.add({
            title: `Resumed ${entry.process.name}`,
            description: `Running again on port ${entry.port}.`,
            type: 'success',
          })
        } catch (e) {
          fail(`Could not resume ${entry.process.name}`, e)
        } finally {
          setBusyPid(null)
          void refresh()
        }
      },

      stop(entry) {
        if (settings.confirmStop) setPendingStop(entry)
        else void doStop(entry, false)
      },

      async reveal(entry) {
        const folder = folderFor(entry)
        if (!folder) return
        try {
          await api.revealInFinder(folder.path)
        } catch (e) {
          fail('Could not open Finder', e)
        }
      },

      async openTerminal(entry) {
        const folder = folderFor(entry)
        if (!folder) return
        try {
          await api.openInTerminal(folder.path)
        } catch (e) {
          fail('Could not open Terminal', e)
        }
      },

      async openEditor(entry) {
        const folder = folderFor(entry)
        if (!folder) return
        try {
          const app = await api.openInEditor(folder.path)
          if (app === 'finder') {
            toast.add({
              title: 'No supported editor found',
              description: 'Opened the folder in Finder instead.',
              type: 'info',
            })
          }
        } catch (e) {
          fail('Could not open editor', e)
        }
      },

      async copy(text, what) {
        await copyText(text)
        toast.add({ title: `${what} copied`, description: text, type: 'success', timeout: 2500 })
      },
    }),
    [busyPid, settings.confirmStop, doStop, toast, fail, refresh],
  )

  return (
    <ActionsContext.Provider value={value}>
      {children}
      <StopDialog
        entry={pendingStop}
        onClose={() => setPendingStop(null)}
        onConfirm={(entry) => {
          setPendingStop(null)
          void doStop(entry, false)
        }}
      />
    </ActionsContext.Provider>
  )
}

function StopDialog({
  entry,
  onClose,
  onConfirm,
}: {
  entry: PortEntry | null
  onClose: () => void
  onConfirm: (entry: PortEntry) => void
}) {
  const [shown, setShown] = React.useState<PortEntry | null>(entry)
  React.useEffect(() => {
    if (entry) setShown(entry)
  }, [entry])

  const target = entry ?? shown

  return (
    <AlertDialog.Root open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <AlertDialog.Popup className="popup fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 p-5">
          <AlertDialog.Title className="text-[14px] font-semibold text-ink">
            Stop {target?.process.name}?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
            It will be asked to quit and release port {target?.port}. Anything unsaved in
            it is lost.
          </AlertDialog.Description>

          {target?.process.command && (
            <p className="selectable mt-3 max-h-20 overflow-auto rounded-md border border-line bg-canvas px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink-faint">
              {target.process.command}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close className="btn">Cancel</AlertDialog.Close>
            <button
              type="button"
              autoFocus
              className="btn border-danger/40 bg-danger/15 text-danger hover:!bg-danger/25"
              onClick={() => target && onConfirm(target)}
            >
              Stop process
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

export function useActions(): Actions {
  const ctx = React.useContext(ActionsContext)
  if (!ctx) throw new Error('useActions must be used inside <ActionsProvider>')
  return ctx
}
