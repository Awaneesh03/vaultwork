import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { messageLogRepo, noteLinkRepo, noteRepo, taskRepo } from '@/repositories'
import {
  captureText,
  dismissCapture,
  EmptyCaptureError,
  listInbox,
  resolveCapture,
} from '@/services'
import { createProject } from '@/services/projectService'
import { freezeClock, resetDatabase } from './helpers'

/**
 * M18.3 end to end, against real IndexedDB: a capture is kept as raw text, it
 * becomes something only when the user accepts, and when it does it goes
 * through the one executor every producer uses — leaving a trail back to the
 * words that started it.
 */

beforeEach(async () => {
  await resetDatabase()
  freezeClock(new Date(2026, 8, 21, 10, 0, 0))
})

const counts = async () => ({
  tasks: await db.tasks.count(),
  notes: await db.notes.count(),
  projects: await db.projects.count(),
  goals: await db.goals.count(),
  habits: await db.habits.count(),
})

describe('capture', () => {
  it('keeps raw text, and survives a fresh read as a reload would', async () => {
    const item = await captureText('  Buy a laptop stand  ')
    expect(item.text).toBe('Buy a laptop stand')

    // A new query, not the object we were handed: the capture is in Dexie.
    const listed = await listInbox()
    expect(listed.map((row) => row.text)).toEqual(['Buy a laptop stand'])
    expect(listed[0]?.classification.proposal.type).toBe('task')
  })

  it('rejects an empty capture and stores nothing', async () => {
    await expect(captureText('   ')).rejects.toBeInstanceOf(EmptyCaptureError)
    expect(await db.messageLog.count()).toBe(0)
  })

  it('creates nothing until the user accepts — capture is not confirmation', async () => {
    const before = await counts()
    await captureText('Study DBMS every day')
    await captureText('Project: FixKaru')
    await captureText('Submit DBMS assignment Friday')
    expect(await counts()).toEqual(before)
  })

  it('lists only inbox captures, never Telegram messages', async () => {
    await messageLogRepo.append({ source: 'telegram', externalId: '42', text: 'from the bot' })
    await captureText('mine')
    expect((await listInbox()).map((row) => row.text)).toEqual(['mine'])
  })
})

describe('accepting a proposal', () => {
  it('creates a task through the executor, attributed to the inbox', async () => {
    const item = await captureText('Submit DBMS assignment Friday')
    const result = await resolveCapture(item.id, item.classification.proposal)

    expect(result.status).toBe('ok')
    const tasks = await taskRepo.listLive()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ title: 'Submit DBMS assignment', dueDate: '2026-09-25' })

    // Provenance for a task lives where this codebase keeps it: on the event.
    const created = await db.events.where('type').equals('task.created').toArray()
    expect(created[0]?.source).toBe('inbox')

    // And the capture records what it became, then leaves the inbox.
    const row = await messageLogRepo.findByExternalId('inbox', item.id)
    expect(row).toMatchObject({
      status: 'done',
      resultEntityType: 'task',
      resultEntityId: tasks[0]?.id,
    })
    expect(await listInbox()).toEqual([])
  })

  it('creates a note through the executor with the capture as its provenance', async () => {
    const item = await captureText('Remember that our backend uses Spring Boot')
    await resolveCapture(item.id, item.classification.proposal)

    const [note] = await noteRepo.listLive()
    expect(note).toMatchObject({ title: 'Our backend uses Spring Boot', kind: null })
    expect(note?.provenance).toEqual({
      source: 'inbox',
      sourceId: item.id,
      sourceUrl: null,
      capturedAt: null,
    })
  })

  it('creates knowledge through the M18.2 path: kind, scaffold and project link', async () => {
    const project = await createProject('Vaultwork')
    const item = await captureText('Research RAG architectures')
    await resolveCapture(item.id, {
      type: 'knowledge',
      title: 'Research RAG architectures',
      kind: 'research',
      projectId: project.id,
    })

    const [note] = await noteRepo.listLive()
    expect(note?.kind).toBe('research')
    expect(note?.body).toContain('## Findings')
    expect(note?.body).toContain('[[Vaultwork]]')
    expect(note?.provenance).toMatchObject({ source: 'inbox', sourceId: item.id })
    expect((await noteLinkRepo.forRef('project', project.id)).map((link) => link.noteId)).toEqual([
      note?.id,
    ])
  })

  it('runs the edited proposal, not the classifier’s', async () => {
    const project = await createProject('College')
    const item = await captureText('Study DBMS Friday')
    await resolveCapture(item.id, {
      type: 'task',
      title: 'Study DBMS',
      dueDate: '2026-09-26',
      dueTime: null,
      projectId: project.id,
    })
    expect((await taskRepo.listLive())[0]).toMatchObject({
      dueDate: '2026-09-26',
      projectId: project.id,
    })
  })

  it('refuses a project id that does not exist, and keeps the capture', async () => {
    const item = await captureText('Ship it')
    const result = await resolveCapture(item.id, {
      type: 'task',
      title: 'Ship it',
      dueDate: null,
      dueTime: null,
      projectId: 'invented-by-someone',
    })

    expect(result.status).toBe('error')
    expect(await taskRepo.listLive()).toEqual([])
    expect((await listInbox()).map((row) => row.id)).toEqual([item.id])
  })

  it('refuses an invalid proposal before any command runs', async () => {
    const item = await captureText('anything')
    const before = await counts()
    for (const bad of [
      { type: 'task.delete', ref: 'x' },
      { type: 'note', title: 'x', body: 'y', provenance: { source: 'claude' } },
      { type: 'event', title: 'x', dueDate: '2026-09-22', dueTime: null, projectId: null },
    ]) {
      expect((await resolveCapture(item.id, bad)).status).toBe('error')
    }
    expect(await counts()).toEqual(before)
  })

  it('will not resolve the same capture twice', async () => {
    const item = await captureText('Buy a laptop stand')
    await resolveCapture(item.id, item.classification.proposal)
    const again = await resolveCapture(item.id, item.classification.proposal)

    expect(again.status).toBe('error')
    expect(await taskRepo.listLive()).toHaveLength(1)
  })

  it('writes nothing secret into provenance, whatever the capture says', async () => {
    const item = await captureText('Remember that the key is sk-live-THISISNOTAREALKEY')
    await resolveCapture(item.id, item.classification.proposal)
    const [note] = await noteRepo.listLive()
    // Provenance is the source and the capture id — never the text.
    expect(JSON.stringify(note?.provenance)).not.toContain('sk-live')
    expect(Object.keys(note?.provenance ?? {}).sort()).toEqual([
      'capturedAt',
      'source',
      'sourceId',
      'sourceUrl',
    ])
  })
})

describe('dismissing', () => {
  it('removes a capture from the inbox but keeps the row', async () => {
    const item = await captureText('never mind')
    await dismissCapture(item.id)

    expect(await listInbox()).toEqual([])
    const row = await messageLogRepo.findByExternalId('inbox', item.id)
    expect(row?.text).toBe('never mind')
    expect(row?.deletedAt).not.toBeNull()
    expect(await counts()).toEqual({ tasks: 0, notes: 0, projects: 0, goals: 0, habits: 0 })
  })
})
