import { settingsRepo } from '@/repositories'
import { writeCachedDensity, writeCachedTheme } from '@/platform/browser/themeCache'
import type { Settings } from '@/types/entities'
import type { Density, EventSource, ThemePreference } from '@/types/enums'

/** Pure: a preference plus the OS state gives one concrete theme. */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): 'light' | 'dark' {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light'
  return preference
}

export function getSettings(): Promise<Settings> {
  return settingsRepo.get()
}

export function updateSettings(
  patch: Partial<Omit<Settings, 'id' | 'createdAt'>>,
  source: EventSource = 'ui',
): Promise<Settings> {
  return settingsRepo.update(patch, source)
}

export async function setTheme(preference: ThemePreference): Promise<Settings> {
  const next = await settingsRepo.update({ theme: preference })
  writeCachedTheme(preference)
  return next
}

export async function setDensity(density: Density): Promise<Settings> {
  const next = await settingsRepo.update({ density })
  writeCachedDensity(density)
  return next
}
