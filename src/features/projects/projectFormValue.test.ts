import { describe, expect, it } from 'vitest'
import type { Project } from '@/types/entities'
import { projectInput } from '../../../tests/factories'
import {
  emptyProjectForm,
  projectForm,
  projectFormError,
  toProjectPatch,
} from './projectFormValue'

/**
 * The boundary between the form's strings and the model's nullable types.
 *
 * Pure, so every rule — what an empty deadline becomes, what a whitespace-only
 * description becomes, which fields a save actually sends — is testable with no
 * form and no database.
 */

function project(overrides: Partial<Project> = {}): Project {
  return {
    ...projectInput(),
    id: 'project-1',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...overrides,
  } as Project
}

describe('validation', () => {
  it('rejects an empty and a whitespace-only name', () => {
    expect(projectFormError(emptyProjectForm())).toBe('A project needs a name')
    expect(projectFormError({ ...emptyProjectForm(), name: '   ' })).toBe(
      'A project needs a name',
    )
  })

  it('accepts anything with a character in it', () => {
    expect(projectFormError({ ...emptyProjectForm(), name: 'C' })).toBeNull()
  })
})

describe('loading a project into the form', () => {
  it('turns every null into the empty string a controlled input needs', () => {
    const value = projectForm(project({ description: null, deadline: null }))
    expect(value.description).toBe('')
    expect(value.deadline).toBe('')
  })

  it('keeps an archived status rather than silently un-archiving on save', () => {
    // The composer must not be a back door out of the archive — that has its
    // own action, its own event and its own undo.
    expect(projectForm(project({ status: 'archived' })).status).toBe('archived')
  })
})

describe('toProjectPatch', () => {
  it('sends only what changed', () => {
    const current = project({ name: 'College', color: 'teal' })
    const value = { ...projectForm(current), color: 'rose' }
    expect(toProjectPatch(value, current)).toEqual({ color: 'rose' })
  })

  it('sends nothing at all when nothing changed', () => {
    const current = project({ name: 'College', description: 'Notes', deadline: '2026-12-31' })
    expect(toProjectPatch(projectForm(current), current)).toEqual({})
  })

  it('collapses whitespace in the name, and does not report a no-op as a change', () => {
    const current = project({ name: 'Semester 5' })
    const value = { ...projectForm(current), name: '  Semester   5  ' }
    expect(toProjectPatch(value, current)).toEqual({})
  })

  it('turns a blanked description and deadline into null', () => {
    const current = project({ description: 'Notes', deadline: '2026-12-31' })
    const value = { ...projectForm(current), description: '   ', deadline: '' }
    expect(toProjectPatch(value, current)).toEqual({ description: null, deadline: null })
  })

  it('never includes the id, so a save cannot re-point the project', () => {
    const current = project()
    const patch = toProjectPatch({ ...projectForm(current), name: 'Renamed' }, current)
    expect(Object.keys(patch)).toEqual(['name'])
  })
})
