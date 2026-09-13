import { describe, expect, it } from 'vitest'
import { DEFAULT_PROJECT_COLOR as SERVICE_COLOR, DEFAULT_PROJECT_ICON as SERVICE_ICON } from '@/services'
import { PROJECT_STATUSES } from '@/types/enums'
import {
  DEFAULT_PROJECT_COLOR,
  DEFAULT_PROJECT_ICON,
  EDITABLE_PROJECT_STATUSES,
  PROJECT_COLORS,
  PROJECT_COLOR_LABELS,
  PROJECT_ICONS,
  PROJECT_ICON_LABELS,
  PROJECT_STATUS_LABELS,
  isProjectColor,
  projectColorVar,
  projectIcon,
} from './projectAppearance'

/**
 * Where the UI and the service both know a fact, this is what keeps them in
 * step. The UI layer may not import a service value, so the defaults are
 * written twice on purpose — and drift fails CI rather than showing up as a
 * project whose stored colour and rendered colour disagree.
 */

describe('duplicated defaults', () => {
  it('agrees with the service on the default colour and icon', () => {
    expect(DEFAULT_PROJECT_COLOR).toBe(SERVICE_COLOR)
    expect(DEFAULT_PROJECT_ICON).toBe(SERVICE_ICON)
  })

  it('offers its own default as a choice', () => {
    expect(PROJECT_COLORS).toContain(DEFAULT_PROJECT_COLOR)
    expect(PROJECT_ICONS).toContain(DEFAULT_PROJECT_ICON)
  })
})

describe('colours', () => {
  it('resolves every colour to a token, never to a literal', () => {
    for (const color of PROJECT_COLORS) {
      expect(projectColorVar(color)).toBe(`var(--project-${color})`)
    }
  })

  it('falls back to the accent for a name it does not know', () => {
    // A project imported from a later version should look plain, not invisible.
    expect(projectColorVar('chartreuse')).toBe('var(--accent)')
    expect(projectColorVar('')).toBe('var(--accent)')
  })

  it('names every colour it offers', () => {
    for (const color of PROJECT_COLORS) {
      expect(PROJECT_COLOR_LABELS[color]).toBeTruthy()
    }
  })

  it('recognises its own colours and nothing else', () => {
    expect(isProjectColor('teal')).toBe(true)
    expect(isProjectColor('chartreuse')).toBe(false)
  })
})

describe('icons', () => {
  it('resolves every icon it offers', () => {
    for (const name of PROJECT_ICONS) {
      // A lucide icon is a forwardRef object, not a plain function.
      expect(projectIcon(name)).toBeTruthy()
      expect(PROJECT_ICON_LABELS[name]).toBeTruthy()
    }
  })

  it('falls back to the folder for an unknown icon', () => {
    expect(projectIcon('spaceship')).toBe(projectIcon('folder'))
  })

  it('resolves the icon names the seed data already uses', () => {
    // M1's seed writes these three; a project created before M4 must still draw.
    for (const name of ['binary', 'graduation-cap', 'globe']) {
      expect(projectIcon(name)).not.toBe(projectIcon('folder'))
    }
  })
})

describe('statuses', () => {
  it('labels every status the model defines', () => {
    for (const status of PROJECT_STATUSES) {
      expect(PROJECT_STATUS_LABELS[status]).toBeTruthy()
    }
  })

  it('keeps archived out of the composer', () => {
    // Archiving emits `project.archived` and carries an undo. Offering it as a
    // dropdown value would produce a `project.updated` where that belongs.
    expect(EDITABLE_PROJECT_STATUSES).not.toContain('archived')
    expect(EDITABLE_PROJECT_STATUSES).toEqual(
      PROJECT_STATUSES.filter((status) => status !== 'archived'),
    )
  })
})
