/**
 * The skyline every dashboard scene shares, and the geometry read from it.
 *
 * Kept apart from the scene components so they stay a components-only module
 * (React fast refresh), and so the rooftop parsing can be tested on its own.
 */

/** The skyline, back row then front row. Shared by every scene. */
export const CITY_BACK =
  'M0 96h22V74h14v22h18V58h16v38h20V80h12v16h24V48h18v48h16V70h14v26h22V86h16v10h26V62h18v34h14V84h12v12h24V54h16v42h18V76h14v20h22V66h16v30h20V88h14v8h26V72h16v24h18V60h14v36h22V82h12v14h20v24H0z'
export const CITY_FRONT =
  'M0 62h30V46h18v16h26V54h16v8h28V38h20v24h18V50h14v12h30V44h18v18h22V56h16v6h28V40h18v22h20V52h14v10h26V46h18v16h24V58h16v4h30v18H0z'

interface Roof {
  x: number
  width: number
  top: number
}

/**
 * The rooftops in a skyline path: every horizontal run (`h`) at the height it
 * was drawn. The paths are step functions — `h`, `V` and `v` only — so this is
 * the whole grammar, and it lets the night scene light windows that are always
 * inside a building rather than painted over the sky.
 */
export function roofsOf(path: string, base: number): Roof[] {
  const roofs: Roof[] = []
  let x = 0
  let y = base
  for (const [, command, value] of path.matchAll(/([hHvVM])\s*(-?\d+(?:\.\d+)?)/g)) {
    const n = Number(value)
    if (command === 'h') {
      if (y < base) roofs.push({ x, width: n, top: y })
      x += n
    } else if (command === 'V') y = n
    else if (command === 'v') y += n
    else if (command === 'H') x = n
  }
  return roofs
}

/** Lit windows for one skyline: a deterministic ~quarter of a regular grid. */
export function windowsFor(path: string, base: number) {
  const lit: { x: number; y: number; warm: boolean }[] = []
  for (const roof of roofsOf(path, base)) {
    for (let x = roof.x + 3; x + 2 <= roof.x + roof.width - 2; x += 5) {
      for (let y = roof.top + 4; y + 3 <= base - 2; y += 7) {
        const hash = (x * 73 + y * 151) % 17
        if (hash < 4) lit.push({ x, y, warm: hash !== 0 })
      }
    }
  }
  return lit
}
