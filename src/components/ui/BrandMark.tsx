/**
 * The Vaultwork mark: two ideas, each on its own path, converging on one point
 * of focus — and the shape they make is the V. Same geometry as
 * `branding/vaultwork-icon.svg`, drawn in theme tokens so it follows light and
 * dark mode rather than baking in the light-theme ember.
 */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <rect width="64" height="64" rx="14" fill="var(--accent)" />
      <g transform="translate(32 32) scale(0.78) translate(-32 -32)" strokeLinecap="round">
        <path d="M50 16 L32 47" stroke="var(--accent-ink)" strokeOpacity={0.7} strokeWidth={7} />
        <path d="M14 16 L32 47" stroke="var(--accent-ink)" strokeWidth={7} />
        <g fill="var(--accent-ink)">
          <circle cx="14" cy="16" r="6" />
          <circle cx="50" cy="16" r="6" />
          <circle cx="32" cy="47" r="8" />
        </g>
      </g>
    </svg>
  )
}
