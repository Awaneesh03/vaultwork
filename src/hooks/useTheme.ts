import { useCallback, useEffect, useState } from 'react'
import { applyThemeAttributes, prefersDark } from '@/platform/browser/themeCache'
import { resolveTheme, setDensity, setTheme } from '@/services'
import type { Density, ThemePreference } from '@/types/enums'
import { useSettings } from './useSettings'

export interface ThemeController {
  preference: ThemePreference
  resolved: 'light' | 'dark'
  density: Density
  setPreference: (preference: ThemePreference) => void
  setDensity: (density: Density) => void
  isLoading: boolean
}

/**
 * Three states, not two: "system" is a real preference that must keep tracking
 * the OS after the page has loaded, so the media query stays subscribed rather
 * than being read once at start-up.
 */
export function useTheme(): ThemeController {
  const settings = useSettings()
  const [systemDark, setSystemDark] = useState(prefersDark)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const list = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [])

  const preference = settings?.theme ?? 'system'
  const density = settings?.density ?? 'comfortable'
  const resolved = resolveTheme(preference, systemDark)

  useEffect(() => {
    applyThemeAttributes(resolved, density)
  }, [resolved, density])

  const setPreference = useCallback((next: ThemePreference) => {
    void setTheme(next)
  }, [])

  const changeDensity = useCallback((next: Density) => {
    void setDensity(next)
  }, [])

  return {
    preference,
    resolved,
    density,
    setPreference,
    setDensity: changeDensity,
    isLoading: settings === undefined,
  }
}
