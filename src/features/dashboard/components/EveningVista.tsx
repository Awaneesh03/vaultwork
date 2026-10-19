/**
 * The evening's one decorative surface.
 *
 * Every other card on this screen reports something. This one does not: it is
 * the visual full stop at the end of the day, and it says so with light rather
 * than with data. Painted entirely in CSS from the theme's own amber, so there
 * is no image to ship, nothing to load, and it follows a theme change like
 * everything else.
 */
/** The same landscape after dark: navy sky, a moon, cool light on the water. */
const NIGHT = {
  sky: 'linear-gradient(178deg, #070b1d 0%, #101a40 45%, #222b63 80%, #2f3674 100%)',
  body: 'radial-gradient(circle at 40% 36%, #fffdf6 0%, #ecebe2 55%, rgba(220, 226, 255, 0.5) 72%, transparent 76%)',
  glow: 'linear-gradient(to top, rgba(150, 168, 236, 0.32) 0%, transparent 100%)',
  far: '#0f1736',
  near: '#090e25',
  haze: 'linear-gradient(to top, rgba(176, 190, 245, 0.32) 0%, transparent 100%)',
  tree: '#060a1a',
  ground:
    'linear-gradient(to top, color-mix(in oklab, var(--sunken) 94%, #1d2a66) 0%, color-mix(in oklab, var(--sunken) 70%, transparent) 45%, transparent 100%)',
  edge: 'color-mix(in oklab, #b9c6ff 26%, var(--line))',
}

const VISTA_STARS = [
  [12, 14],
  [24, 30],
  [38, 10],
  [52, 22],
  [66, 8],
  [80, 26],
  [90, 12],
  [46, 38],
] as const

export function EveningVista({ night = false }: { night?: boolean }) {
  return (
    <section
      aria-label="Good work today"
      data-sky={night ? 'night' : 'evening'}
      className="relative flex min-h-[13.5rem] flex-col justify-end overflow-hidden rounded-xl border border-[color-mix(in_oklab,var(--warn)_26%,var(--line))] p-5"
      style={{
        background: night
          ? NIGHT.sky
          : 'linear-gradient(178deg, color-mix(in oklab, var(--sunken) 82%, var(--danger)) 0%, color-mix(in oklab, var(--sunken) 44%, var(--danger)) 40%, color-mix(in oklab, var(--danger) 48%, var(--warn)) 70%, color-mix(in oklab, var(--warn) 82%, var(--surface)) 100%)',
        ...(night ? { borderColor: NIGHT.edge } : {}),
      }}
    >
      {night
        ? VISTA_STARS.map(([left, top]) => (
            <span
              key={`${left}-${top}`}
              className="pointer-events-none absolute h-px w-px rounded-full bg-white opacity-80"
              style={{ left: `${left}%`, top: `${top}%` }}
              aria-hidden
            />
          ))
        : null}
      {/* The setting sun, low and half behind the ridge — or, after dark, the moon. */}
      <div
        className={
          night
            ? 'pointer-events-none absolute top-6 right-10 h-10 w-10 rounded-full'
            : 'pointer-events-none absolute right-10 bottom-12 h-16 w-16 rounded-full blur-[2px]'
        }
        style={
          night
            ? { background: NIGHT.body, boxShadow: '0 0 28px 8px rgba(210, 220, 255, 0.35)' }
            : {
                background:
                  'radial-gradient(circle, color-mix(in oklab, var(--warn) 92%, white) 0%, color-mix(in oklab, var(--warn) 82%, transparent) 52%, transparent 72%)',
              }
        }
        aria-hidden
      />
      {/* Its glow spreading along the horizon. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 opacity-90"
        style={{
          background: night
            ? NIGHT.glow
            : 'linear-gradient(to top, color-mix(in oklab, var(--warn) 56%, transparent) 0%, transparent 100%)',
        }}
        aria-hidden
      />

      {/* Two ridges: the far one catching light, the near one dark. */}
      <svg
        className="pointer-events-none absolute inset-x-0 bottom-0 h-20 w-full"
        viewBox="0 0 320 80"
        preserveAspectRatio="none"
        fill="none"
        aria-hidden
      >
        <path
          d="M0 54C40 44 72 60 108 52C150 42 186 24 226 32C262 39 292 54 320 50V80H0V54Z"
          fill={night ? NIGHT.far : 'color-mix(in oklab, var(--sunken) 86%, var(--danger))'}
        />
        <path
          d="M0 68C44 60 84 72 128 66C176 59 214 48 258 54C286 58 304 66 320 64V80H0V68Z"
          fill={night ? NIGHT.near : 'color-mix(in oklab, var(--sunken) 97%, var(--danger))'}
        />
      </svg>

      {/* Haze lying along the water line. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-[28%] h-10 opacity-60 blur-md"
        style={{
          background: night
            ? NIGHT.haze
            : 'linear-gradient(to top, color-mix(in oklab, var(--warn) 50%, transparent) 0%, transparent 100%)',
        }}
        aria-hidden
      />

      {/* A tree on the near bank, the darkest thing in the frame. */}
      <svg
        className="pointer-events-none absolute bottom-2 left-[58%] h-20 w-16 opacity-95"
        viewBox="0 0 80 96"
        fill={night ? NIGHT.tree : 'color-mix(in oklab, var(--sunken) 96%, var(--danger))'}
        aria-hidden
      >
        <path d="M37 96h6V58c9-1 17-7 19-16 2-10-5-19-15-20-3-7-11-11-19-9-9 2-14 10-13 19 1 8 8 14 16 15l6 1z" />
        <path d="M30 96h20c-2-6-8-10-10-16-2 6-8 10-10 16z" opacity="0.5" />
      </svg>

      {/* The ground the words stand on, so they stay readable at any hour. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%]"
        style={{
          background: night
            ? NIGHT.ground
            : 'linear-gradient(to top, color-mix(in oklab, var(--sunken) 94%, var(--danger)) 0%, color-mix(in oklab, var(--sunken) 70%, transparent) 45%, transparent 100%)',
        }}
        aria-hidden
      />

      <div className="relative z-10">
        <p className="text-strong font-semibold tracking-tight text-ink">Good work today.</p>
        <p className="text-meta text-ink-2">Consistency wins.</p>
      </div>
    </section>
  )
}
