import type { Density, ThemePreference } from '@/types/enums'

const THEME_KEY = 'vaultwork.theme'
const DENSITY_KEY = 'vaultwork.density'

/**
 * A cache, not a source of truth.
 *
 * Settings live in Dexie. But Dexie opens asynchronously, and a theme that
 * arrives 80ms after first paint is a white flash on a dark screen. So the
 * resolved preference is mirrored to localStorage, read by the inline script in
 * index.html before React mounts, and corrected once the real settings load.
 */
export function readCachedTheme(): ThemePreference | null {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return value === 'light' || value === 'dark' || value === 'system' ? value : null
  } catch {
    return null
  }
}

export function writeCachedTheme(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, preference)
  } catch {
    /* Private mode or blocked storage — the app still works, it just flashes. */
  }
}

export function readCachedDensity(): Density | null {
  try {
    const value = localStorage.getItem(DENSITY_KEY)
    return value === 'comfortable' || value === 'compact' ? value : null
  } catch {
    return null
  }
}

export function writeCachedDensity(density: Density): void {
  try {
    localStorage.setItem(DENSITY_KEY, density)
  } catch {
    /* ignored — see above */
  }
}

/** Stamps the resolved theme on <html>, which every token keys off. */
export function applyThemeAttributes(resolved: 'light' | 'dark', density: Density): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = resolved
  document.documentElement.dataset.density = density
}

export function prefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}
