import type { CSSProperties, ReactNode } from 'react'
import type { TimeOfDay } from '../timeOfDay'
import { CITY_BACK, CITY_FRONT, windowsFor } from '../skyline'

/**
 * The hero's four skies.
 *
 * One window, one city, four times of day. Every scene is the same room looking
 * out through the same window at the same skyline; only the sky, the light and
 * the weather of the hour change. That is what keeps four scenes reading as one
 * product rather than four stock backgrounds — and it is why the evening scene,
 * which came first and is approved, is the template the others follow.
 *
 * Everything is CSS gradients and inline SVG: no image files, nothing fetched,
 * nothing to go missing from a build. The room's shading is drawn in the
 * theme's own `--sunken`, so the words on the left stay readable in light and
 * dark themes over every sky. Decorative only — `aria-hidden` throughout.
 */

// ------------------------------------------------------------------- the city

const BACK_WINDOWS = windowsFor(CITY_BACK, 120)
const FRONT_WINDOWS = windowsFor(CITY_FRONT, 80)

function City({
  back,
  front,
  windows = false,
}: {
  back: string
  front: string
  windows?: boolean
}) {
  return (
    <>
      <svg
        className="absolute inset-x-0 bottom-0 h-24 w-full sm:h-28"
        viewBox="0 0 600 120"
        preserveAspectRatio="none"
      >
        <path d={CITY_BACK} fill={back} />
        {windows
          ? BACK_WINDOWS.map((w) => (
              <rect
                key={`b${w.x}-${w.y}`}
                x={w.x}
                y={w.y}
                width={2}
                height={3}
                fill={w.warm ? '#ffd98c' : '#fff3cf'}
                opacity={0.7}
              />
            ))
          : null}
      </svg>
      <svg
        className="absolute inset-x-0 bottom-0 h-16 w-full sm:h-20"
        viewBox="0 0 600 80"
        preserveAspectRatio="none"
        data-part={windows ? 'lit-windows' : undefined}
      >
        <path d={CITY_FRONT} fill={front} />
        {windows
          ? FRONT_WINDOWS.map((w) => (
              <rect
                key={`f${w.x}-${w.y}`}
                x={w.x}
                y={w.y}
                width={2}
                height={3}
                fill={w.warm ? '#ffcf73' : '#fff0c2'}
                opacity={0.85}
              />
            ))
          : null}
      </svg>
    </>
  )
}

// ------------------------------------------------------------------- the room

/** Two mullions and a transom, in the room's own shadow tinted by the sky. */
function Window({ tint }: { tint: string }) {
  const frame: CSSProperties = { background: `color-mix(in oklab, var(--sunken) 94%, ${tint})` }
  return (
    <>
      <div className="absolute inset-y-0 left-[44%] w-[4px]" style={frame} />
      <div className="absolute inset-y-0 left-[76%] w-[4px]" style={frame} />
      <div className="absolute inset-x-[42%] top-[38%] h-[3px]" style={frame} />
    </>
  )
}

/** The room itself: dark at the left, where the words are, and at the sill. */
function Room() {
  return (
    <>
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(100deg, var(--sunken) 0%, color-mix(in oklab, var(--sunken) 92%, transparent) 24%, color-mix(in oklab, var(--sunken) 55%, transparent) 44%, transparent 66%)',
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-20"
        style={{
          background:
            'linear-gradient(to top, color-mix(in oklab, var(--sunken) 88%, transparent) 0%, transparent 100%)',
        }}
      />
    </>
  )
}

function Frame({ scene, children }: { scene: TimeOfDay; children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden data-scene-art={scene}>
      {children}
    </div>
  )
}

/** A cumulus cloud: overlapping circles with a soft shaded underside. */
function Cloud({
  className,
  fill,
  shade,
  style,
}: {
  className: string
  fill: string
  shade: string
  style?: CSSProperties
}) {
  return (
    <svg className={`absolute ${className}`} style={style} viewBox="0 0 120 50">
      <ellipse cx="62" cy="40" rx="52" ry="9" fill={shade} />
      <g fill={fill}>
        <circle cx="30" cy="32" r="14" />
        <circle cx="50" cy="24" r="19" />
        <circle cx="74" cy="27" r="16" />
        <circle cx="94" cy="33" r="11" />
        <rect x="18" y="30" width="86" height="12" rx="6" />
      </g>
    </svg>
  )
}

// ------------------------------------------------------------------ the scenes

/** 05:00–11:59 — peach and cream, the sun lifting out of the haze. */
function MorningScene() {
  return (
    <Frame scene="morning">
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, #e9c6c0 0%, #f4d6c3 30%, #f9e4c9 58%, #fbe0b0 80%, #f6c98c 100%)',
        }}
      />
      {/* The sun, half risen: its halo first, the disc behind the city. */}
      <div
        className="absolute right-[18%] bottom-[2%] h-80 w-80 rounded-full opacity-90 blur-2xl"
        style={{
          background:
            'radial-gradient(circle, rgba(255, 226, 168, 0.95) 0%, rgba(255, 204, 140, 0.45) 45%, transparent 72%)',
        }}
      />
      <div
        className="absolute right-[27%] bottom-[18%] h-24 w-24 rounded-full blur-[3px]"
        data-part="sun"
        style={{
          background:
            'radial-gradient(circle, #fffaf0 0%, #ffe9bd 55%, rgba(255, 214, 150, 0.6) 75%, transparent 100%)',
        }}
      />
      <div className="scene-drift absolute inset-x-0 top-[10%] h-24">
        <Cloud
          className="right-[8%] top-0 w-56 opacity-60 blur-[2px]"
          fill="#fff6ee"
          shade="#f1cdbd"
        />
        <Cloud
          className="right-[46%] top-8 w-40 opacity-40 blur-[3px]"
          fill="#fff3ea"
          shade="#efc9b8"
        />
      </div>
      <City
        back="color-mix(in oklab, #b88a86 78%, #f6d5bd)"
        front="color-mix(in oklab, #8c6670 86%, #f6d5bd)"
      />
      {/* Morning mist lying over the city. */}
      <div
        className="scene-drift absolute inset-x-[-5%] bottom-[10%] h-16 blur-xl"
        style={{
          background:
            'linear-gradient(to right, transparent 0%, rgba(255, 246, 236, 0.75) 30%, rgba(255, 240, 226, 0.6) 70%, transparent 100%)',
        }}
      />
      <Window tint="#c98a6a" />
      <Room />
    </Frame>
  )
}

/** 12:00–16:59 — clear daylight, a high sun and fair-weather cloud. */
function AfternoonScene() {
  return (
    <Frame scene="afternoon">
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, #4f93cf 0%, #74afe0 34%, #a8cff0 66%, #dceaf2 88%, #efe9da 100%)',
        }}
      />
      {/* A radiant sun, high and to the right, with its wide bloom. */}
      <div
        className="absolute -top-16 right-[6%] h-80 w-80 rounded-full opacity-80 blur-2xl"
        style={{
          background:
            'radial-gradient(circle, rgba(255, 250, 222, 0.95) 0%, rgba(255, 240, 190, 0.4) 40%, transparent 70%)',
        }}
      />
      <div
        className="absolute top-[12%] right-[18%] h-16 w-16 rounded-full"
        data-part="sun"
        style={{
          background:
            'radial-gradient(circle, #ffffff 0%, #fff8dc 50%, rgba(255, 236, 170, 0.7) 78%, transparent 100%)',
          boxShadow: '0 0 60px 18px rgba(255, 244, 200, 0.55)',
        }}
      />
      <div className="scene-drift absolute inset-0">
        <Cloud className="right-[30%] top-[16%] w-44 opacity-95" fill="#ffffff" shade="#d6e4f0" />
        <Cloud className="right-[2%] top-[34%] w-36 opacity-90" fill="#fbfdff" shade="#d2e0ec" />
        <Cloud className="right-[54%] top-[8%] w-28 opacity-80" fill="#ffffff" shade="#d8e5f1" />
      </div>
      <City
        back="color-mix(in oklab, #7f9bb5 82%, #e8f0f6)"
        front="color-mix(in oklab, #58718b 90%, #e8f0f6)"
      />
      <Window tint="#6f8aa3" />
      <Room />
    </Frame>
  )
}

/** 17:00–20:59 — the approved sunset, unchanged. */
function EveningScene() {
  return (
    <Frame scene="evening">
      {/* The sky, from dusk overhead down to the fire on the horizon. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, color-mix(in oklab, var(--sunken) 78%, var(--danger)) 0%, color-mix(in oklab, var(--sunken) 42%, var(--danger)) 34%, color-mix(in oklab, var(--danger) 52%, var(--warn)) 62%, color-mix(in oklab, var(--warn) 86%, var(--surface)) 100%)',
        }}
      />

      {/* The sun, low and heavy, with its haze around it. */}
      <div
        className="absolute h-28 w-28 rounded-full blur-[6px]"
        data-part="sun"
        style={{
          right: '26%',
          bottom: '26%',
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--warn) 92%, white) 0%, color-mix(in oklab, var(--warn) 88%, transparent) 50%, transparent 72%)',
        }}
      />
      <div
        className="absolute right-[6%] bottom-[8%] h-64 w-[36rem] rounded-full opacity-80 blur-3xl"
        style={{
          background:
            'radial-gradient(ellipse, color-mix(in oklab, var(--warn) 78%, transparent) 0%, transparent 70%)',
        }}
      />

      {/* The city, flat against the light. */}
      <City
        back="color-mix(in oklab, var(--sunken) 72%, var(--danger))"
        front="color-mix(in oklab, var(--sunken) 90%, var(--danger))"
      />

      <Window tint="var(--danger)" />
      <Room />
    </Frame>
  )
}

/** A fixed field of stars, so the sky is the same every night. */
const STARS = Array.from({ length: 46 }, (_, i) => {
  const a = (i * 9301 + 49297) % 233280
  const b = (a * 9301 + 49297) % 233280
  const c = (b * 9301 + 49297) % 233280
  return {
    left: 40 + (a / 233280) * 58,
    top: 3 + (b / 233280) * 56,
    size: c % 7 === 0 ? 2.5 : c % 3 === 0 ? 1.5 : 1,
    opacity: 0.45 + ((c % 50) / 50) * 0.5,
  }
})

/** 21:00–04:59 — a clear night: moon, stars, a few clouds, the city lit. */
function NightScene() {
  return (
    <Frame scene="night">
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, #060a1c 0%, #0b1433 30%, #16214e 62%, #26306a 86%, #343a7a 100%)',
        }}
      />
      <div data-part="stars">
        {STARS.map((star) => (
          <span
            key={`${star.left.toFixed(2)}-${star.top.toFixed(2)}`}
            className="absolute rounded-full bg-white"
            style={{
              left: `${star.left}%`,
              top: `${star.top}%`,
              width: star.size,
              height: star.size,
              opacity: star.opacity,
              boxShadow: star.size > 2 ? '0 0 6px rgba(220, 228, 255, 0.8)' : undefined,
            }}
          />
        ))}
      </div>
      {/* Moonlight, then the moon: full, bright, faintly marked. */}
      <div
        className="absolute top-[-16%] right-[20%] h-80 w-80 rounded-full opacity-70 blur-3xl"
        style={{
          background:
            'radial-gradient(circle, rgba(196, 210, 255, 0.55) 0%, rgba(150, 170, 240, 0.18) 45%, transparent 70%)',
        }}
      />
      <div
        className="absolute top-[11%] right-[34%] h-[4.5rem] w-[4.5rem] overflow-hidden rounded-full"
        data-part="moon"
        style={{
          background:
            'radial-gradient(circle at 38% 34%, #fffdf6 0%, #f3f0e4 46%, #dcdbd0 78%, #c9cac4 100%)',
          boxShadow:
            '0 0 36px 10px rgba(225, 232, 255, 0.45), 0 0 90px 30px rgba(160, 180, 255, 0.18)',
        }}
      >
        <span className="absolute top-[22%] left-[52%] h-3 w-3 rounded-full bg-[#cfcdc2] opacity-60" />
        <span className="absolute top-[52%] left-[28%] h-4 w-4 rounded-full bg-[#d4d2c7] opacity-50" />
        <span className="absolute top-[60%] left-[62%] h-2 w-2 rounded-full bg-[#cbc9bd] opacity-55" />
      </div>
      {/* A few birds crossing the moonlight, far off. */}
      <svg
        className="absolute top-[30%] right-[25%] h-8 w-24"
        viewBox="0 0 96 32"
        fill="none"
        stroke="#0b1029"
        strokeWidth="1.6"
        strokeLinecap="round"
        data-part="birds"
      >
        <path d="M6 14q5-5 9 0q4-5 9 0" />
        <path d="M34 8q4-4 7 0q3-4 7 0" />
        <path d="M60 20q3.5-3.5 6 0q2.5-3.5 6 0" />
      </svg>
      {/* Thin cloud drifting below the moon. */}
      <div className="scene-drift absolute inset-0">
        <div
          className="absolute top-[38%] right-[10%] h-6 w-64 rounded-full opacity-45 blur-md"
          style={{ background: 'rgba(92, 104, 168, 0.75)' }}
        />
        <div
          className="absolute top-[24%] right-[40%] h-4 w-48 rounded-full opacity-35 blur-md"
          style={{ background: 'rgba(110, 120, 180, 0.7)' }}
        />
      </div>
      <City back="#111a3d" front="#0a1029" windows />
      <Window tint="#1d2a66" />
      <Room />
    </Frame>
  )
}

const SCENES: Record<TimeOfDay, () => ReactNode> = {
  morning: MorningScene,
  afternoon: AfternoonScene,
  evening: EveningScene,
  night: NightScene,
}

/** The sky for one time of day, drawn behind the hero's words. */
export function DashboardScene({ timeOfDay }: { timeOfDay: TimeOfDay }) {
  const Scene = SCENES[timeOfDay]
  return <Scene />
}
