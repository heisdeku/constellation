import { createFileRoute } from '@tanstack/react-router'
import { RotateCcw } from 'lucide-react'
import { SelectField, SwitchField } from '~/components/ui'
import { DEFAULT_SETTINGS, useApp } from '~/lib/store'

export const Route = createFileRoute('/settings')({ component: SettingsPage })

const REFRESH_ITEMS = [
  { value: 1000, label: 'Every second' },
  { value: 2000, label: 'Every 2 seconds' },
  { value: 3000, label: 'Every 3 seconds' },
  { value: 5000, label: 'Every 5 seconds' },
  { value: 10000, label: 'Every 10 seconds' },
  { value: 30000, label: 'Every 30 seconds' },
] as const

const GRACE_ITEMS = [
  { value: 1000, label: '1 second' },
  { value: 3000, label: '3 seconds' },
  { value: 5000, label: '5 seconds' },
  { value: 10000, label: '10 seconds' },
] as const

function SettingsPage() {
  const { settings, updateSettings, resetSettings } = useApp()
  const isDefault =
    JSON.stringify(settings) === JSON.stringify(DEFAULT_SETTINGS)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[600px] px-6 pb-8 pt-5">
        <div className="sticky top-0 z-10 -mt-5 flex items-center justify-between gap-4 bg-surface pb-6 pt-5">
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">Settings</h1>
          <button
            type="button"
            onClick={resetSettings}
            disabled={isDefault}
            className="btn shrink-0"
          >
            <RotateCcw size={12} /> Restore Defaults
          </button>
        </div>

        <Section title="Ports">
          <FieldRow label="Rescan">
            <SelectField
              ariaLabel="Rescan"
              value={settings.refreshMs}
              onChange={(refreshMs) => updateSettings({ refreshMs })}
              items={REFRESH_ITEMS}
              className="w-[168px]"
            />
          </FieldRow>

          <SwitchField
            label="Show UDP ports"
            hint="Adds many macOS background services, such as AirDrop."
            checked={settings.includeUdp}
            onChange={(includeUdp) => updateSettings({ includeUdp })}
          />

          <SwitchField
            label="Hide other users' ports"
            checked={settings.hideSystem}
            onChange={(hideSystem) => updateSettings({ hideSystem })}
          />
        </Section>

        <Section title="Stopping">
          <SwitchField
            label="Confirm before stopping"
            checked={settings.confirmStop}
            onChange={(confirmStop) => updateSettings({ confirmStop })}
          />

          <FieldRow
            label="Time to quit"
            hint="How long a process gets to quit before Force stop is offered."
          >
            <SelectField
              ariaLabel="Time to quit"
              value={settings.graceMs}
              onChange={(graceMs) => updateSettings({ graceMs })}
              items={GRACE_ITEMS}
              className="w-[132px]"
            />
          </FieldRow>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-ink-faint">
        {title}
      </h2>
      <div className="divide-y divide-line-soft rounded-card border border-line bg-surface px-5">
        {children}
      </div>
    </section>
  )
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-[11.5px] leading-snug text-ink-faint">{hint}</p>}
      </div>
      <div className="mt-0.5 shrink-0">{children}</div>
    </div>
  )
}
