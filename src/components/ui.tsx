import * as React from 'react'
import { Tooltip } from '@base-ui-components/react/tooltip'
import { Select } from '@base-ui-components/react/select'
import { Switch } from '@base-ui-components/react/switch'
import { Check, ChevronsUpDown } from 'lucide-react'

export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ')

/** Wraps a single interactive child with a tooltip. */
export function Tip({
  content,
  side = 'top',
  children,
}: {
  content: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  children: React.ReactElement<Record<string, unknown>>
}) {
  if (!content) return children
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner side={side} sideOffset={7}>
          <Tooltip.Popup className="popup max-w-[280px] px-2.5 py-1.5 text-[11.5px] leading-snug text-ink-dim">
            {content}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export function Chip({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: 'neutral' | 'live' | 'held' | 'danger' | 'info' | 'violet'
  className?: string
  children: React.ReactNode
}) {
  const tones = {
    neutral: 'border-line bg-surface-2 text-ink-faint',
    live: 'border-live/25 bg-live/10 text-live',
    held: 'border-held/25 bg-held/10 text-held',
    danger: 'border-danger/25 bg-danger/10 text-danger',
    info: 'border-info/25 bg-info/10 text-info',
    violet: 'border-violet/25 bg-violet/10 text-violet',
  }
  return <span className={cx('chip', tones[tone], className)}>{children}</span>
}

export function SelectField<T extends string | number>({
  value,
  onChange,
  items,
  className,
  ariaLabel,
}: {
  value: T
  onChange: (value: T) => void
  items: ReadonlyArray<{ value: T; label: string }>
  className?: string
  ariaLabel: string
}) {
  return (
    <Select.Root
      value={value}
      onValueChange={(next) => onChange(next as T)}
      items={items as unknown as Array<{ label: React.ReactNode; value: unknown }>}
    >
      <Select.Trigger
        aria-label={ariaLabel}
        className={cx('btn min-w-0 justify-between gap-2', className)}
      >
        <Select.Value className="truncate" />
        <Select.Icon>
          <ChevronsUpDown size={12} className="shrink-0 text-ink-faint" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={6} alignItemWithTrigger={false}>
          <Select.Popup className="popup min-w-[var(--anchor-width)]">
            {items.map((item) => (
              <Select.Item key={String(item.value)} value={item.value} className="menu-item pr-6">
                <Select.ItemIndicator className="absolute right-2">
                  <Check size={12} />
                </Select.ItemIndicator>
                <Select.ItemText>{item.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}

export function SwitchField({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  hint?: string
}) {
  const id = React.useId()
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-[12.5px] font-medium text-ink">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-[11.5px] leading-snug text-ink-faint">{hint}</p>}
      </div>
      <Switch.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border border-line
          bg-surface-3 px-[2px] transition-colors duration-150
          data-[checked]:border-live/40 data-[checked]:bg-live/25"
      >
        <Switch.Thumb
          className="size-[14px] rounded-full bg-ink-faint transition-[translate,background-color]
            duration-150 ease-out data-[checked]:translate-x-4 data-[checked]:bg-live"
        />
      </Switch.Root>
    </div>
  )
}

/** Small coloured dot conveying process state at a glance. */
export function StateDot({ state, paused }: { state: string; paused: boolean }) {
  const tone = paused
    ? 'bg-held'
    : state === 'running'
      ? 'bg-live'
      : state === 'zombie'
        ? 'bg-danger'
        : 'bg-live/50'
  return <span className={cx('inline-block size-[7px] shrink-0 rounded-full', tone)} />
}

/** The title row every page starts with. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header className="flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-5">
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-[12.5px] text-ink-faint">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Empty({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body?: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="text-ink-faint/60">{icon}</div>
      <div>
        <p className="text-[13px] font-medium text-ink-dim">{title}</p>
        {body && (
          <p className="mt-1 max-w-[380px] text-[12px] leading-relaxed text-ink-faint">{body}</p>
        )}
      </div>
    </div>
  )
}
