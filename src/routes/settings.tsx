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
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight text-ink">Settings</h1>
            <p className="mt-0.5 text-[12px] text-ink-faint">
              Stored locally. Nothing leaves your machine.
            </p>
          </div>
          <button
            type="button"
            onClick={resetSettings}
            disabled={isDefault}
            className="btn shrink-0"
          >
            <RotateCcw size={12} /> Reset
          </button>
        </div>

        <Section title="Port scanning">
          <FieldRow
            label="Refresh interval"
            hint="How often ports are rescanned while tracking is on."
          >
            <SelectField
              ariaLabel="Refresh interval"
              value={settings.refreshMs}
              onChange={(refreshMs) => updateSettings({ refreshMs })}
              items={REFRESH_ITEMS}
              className="w-[168px]"
            />
          </FieldRow>

          <SwitchField
            label="Include UDP sockets"
            hint="UDP has no listening state, so this adds a lot of system chatter — mDNS, AirDrop, and friends."
            checked={settings.includeUdp}
            onChange={(includeUdp) => updateSettings({ includeUdp })}
          />

          <SwitchField
            label="Hide ports owned by other users"
            hint="Most of these are macOS daemons you cannot signal anyway."
            checked={settings.hideSystem}
            onChange={(hideSystem) => updateSettings({ hideSystem })}
          />
        </Section>

        <Section title="Stopping processes">
          <SwitchField
            label="Confirm before stopping"
            hint="Show a confirmation dialog before sending SIGTERM."
            checked={settings.confirmStop}
            onChange={(confirmStop) => updateSettings({ confirmStop })}
          />

          <FieldRow
            label="Grace period"
            hint="How long to wait for a clean exit before offering to force stop with SIGKILL."
          >
            <SelectField
              ariaLabel="Grace period"
              value={settings.graceMs}
              onChange={(graceMs) => updateSettings({ graceMs })}
              items={GRACE_ITEMS}
              className="w-[132px]"
            />
          </FieldRow>
        </Section>

        <Section title="How it works">
          {/* Inline code chips add visual height to each line, so this block needs
              looser leading and paragraph spacing than ordinary prose would. */}
          <div className="space-y-4 py-5 text-[12px] leading-[1.85] text-ink-faint">
            <p>
              Ports come from <Code>lsof</Code>, and process details from{' '}
              <Code>ps</Code>. Both run as you — no admin rights, no daemon.
            </p>
            <p>
              <span className="text-ink-dim">Pause</span> sends{' '}
              <Code>SIGSTOP</Code>. The process freezes but keeps the port bound, so
              nothing else can grab it.{' '}
              <span className="text-ink-dim">Resume</span> sends <Code>SIGCONT</Code>{' '}
              and it continues exactly where it stopped.
            </p>
            <p>
              <span className="text-ink-dim">Stop</span> sends <Code>SIGTERM</Code>. If
              the process ignores it past the grace period, you get the choice to
              escalate to <Code>SIGKILL</Code>.
            </p>
            <p>
              Protected system processes and anything running as another user are
              never signalled.
            </p>
            <p>
              <span className="text-ink-dim">Storage</span> sizes count what deleting
              would really free. APFS clones share disk blocks, so a folder can look
              far bigger in <Code>du</Code> than the space it gives back.
            </p>
          </div>
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
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-ink">{label}</p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-ink-faint">{hint}</p>
      </div>
      <div className="mt-0.5 shrink-0">{children}</div>
    </div>
  )
}

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="whitespace-nowrap rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-ink-dim">
    {children}
  </code>
)
