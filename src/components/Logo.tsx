import { useId } from 'react'

/** The marè crescent, drawn the same way as the app icon in docs/icon.svg. */
export function Logo({ size = 22 }: { size?: number }) {
  const mask = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={`${mask}-moon`} x1="0.15" y1="0.1" x2="0.85" y2="0.95">
          <stop offset="0" stopColor="#fbf7ee" />
          <stop offset="0.55" stopColor="#e3dfd6" />
          <stop offset="1" stopColor="#a9b2c4" />
        </linearGradient>
        <mask id={mask}>
          <rect width="24" height="24" fill="black" />
          <circle cx="11.2" cy="12.6" r="8.6" fill="white" />
          <circle cx="15" cy="9.4" r="7.6" fill="black" />
        </mask>
      </defs>
      <rect width="24" height="24" fill={`url(#${mask}-moon)`} mask={`url(#${mask})`} />
    </svg>
  )
}
