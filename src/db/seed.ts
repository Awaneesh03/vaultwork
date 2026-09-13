import { buildVaultPath } from '@/integrations/obsidian/vaultPath'
import { addDays, nowTs, todayStr } from '@/lib/date'
import { newId } from '@/lib/id'
import type {
  AppEvent,
  Goal,
  Habit,
  HabitEntry,
  Milestone,
  Note,
  NoteLink,
  Project,
  Settings,
  Task,
  Tag,
} from '@/types/entities'
import { CURRENT_SCHEMA_VERSION } from './migrations'
import type { VaultworkDatabase } from './schema'

/**
 * Development seed data.
 *
 * It exists so the shell has something real to render before the task UI is
 * built in M3, and so every index has rows to exercise. Seeding writes rows
 * directly rather than through repositories: a repository write would emit a
 * `*.created` event per row with `source: 'ui'`, and fabricated history in the
 * event log would poison analytics from day one. One `app.seeded` marker event
 * is written instead.
 */

const base = (at: number) => ({ createdAt: at, updatedAt: at, deletedAt: null })

export const DEFAULT_SETTINGS = (at = nowTs()): Settings => ({
  id: 'singleton',
  ...base(at),
  theme: 'system',
  density: 'comfortable',
  pomodoro: { workMin: 25, shortBreakMin: 5, longBreakMin: 15, cyclesBeforeLongBreak: 4 },
  dailyTaskGoal: 5,
  weekStartsOn: 1,
  vault: null,
  schemaVersion: CURRENT_SCHEMA_VERSION,
})

export interface SeedResult {
  seeded: boolean
  counts: Record<string, number>
}

export async function isDatabaseEmpty(db: VaultworkDatabase): Promise<boolean> {
  const [tasks, projects, habits, goals] = await Promise.all([
    db.tasks.count(),
    db.projects.count(),
    db.habits.count(),
    db.goals.count(),
  ])
  return tasks + projects + habits + goals === 0
}

export function buildSeed(now: Date = new Date()) {
  const at = now.getTime()
  const today = todayStr(now)

  const tag = (name: string, color: string): Tag => ({ id: newId(), ...base(at), name, color })
  const tags = {
    dsa: tag('dsa', 'teal'),
    java: tag('java', 'amber'),
    college: tag('college', 'slate'),
    health: tag('health', 'green'),
    reading: tag('reading', 'violet'),
  }

  const goal: Goal = {
    id: newId(),
    ...base(at),
    title: 'Become strong in DSA',
    why: 'Placement season starts in eight months and I want to walk in confident.',
    horizon: 'long',
    status: 'active',
    targetDate: addDays(today, 240),
    sortOrder: 1000,
    vaultPath: null,
  }

  const milestoneTitles = ['Arrays', 'Linked Lists', 'Trees', 'Graphs', 'Dynamic Programming']
  const milestones: Milestone[] = milestoneTitles.map((title, i) => ({
    id: newId(),
    ...base(at),
    goalId: goal.id,
    title,
    targetDate: addDays(today, 40 * (i + 1)),
    done: i < 1,
    sortOrder: (i + 1) * 1000,
  }))

  const project = (
    name: string,
    status: Project['status'],
    icon: string,
    color: string,
    order: number,
    extra: Partial<Project> = {},
  ): Project => ({
    id: newId(),
    ...base(at),
    name,
    description: null,
    color,
    icon,
    status,
    deadline: null,
    goalId: null,
    tagIds: [],
    sortOrder: order,
    vaultPath: null,
    ...extra,
  })

  const projects = {
    dsa: project('DSA Mastery', 'active', 'binary', 'teal', 1000, {
      description: 'Structured practice, one topic at a time.',
      goalId: goal.id,
      tagIds: [tags.dsa.id, tags.java.id],
      deadline: addDays(today, 240),
    }),
    semester: project('Semester 5', 'active', 'graduation-cap', 'slate', 2000, {
      description: 'Coursework, labs and internals.',
      tagIds: [tags.college.id],
      deadline: addDays(today, 90),
    }),
    portfolio: project('Portfolio Site', 'planning', 'globe', 'violet', 3000, {
      description: 'Something to point recruiters at.',
    }),
  }

  const task = (
    title: string,
    order: number,
    extra: Partial<Task> = {},
  ): Task => ({
    id: newId(),
    ...base(at),
    title,
    description: null,
    status: 'todo',
    priority: 'none',
    dueDate: null,
    dueTime: null,
    startDate: null,
    estimateMin: null,
    projectId: null,
    milestoneId: null,
    tagIds: [],
    recurrence: null,
    seriesId: null,
    isTemplate: false,
    sortOrder: order,
    completedAt: null,
    reminderAt: null,
    vaultPath: null,
    ...extra,
  })

  const treesMilestone = milestones[2] as Milestone

  const tasks: Task[] = [
    task('Study Binary Trees', 1000, {
      description: 'Traversals first, then BST insert/delete.',
      priority: 'high',
      dueDate: today,
      dueTime: '19:00',
      estimateMin: 45,
      projectId: projects.dsa.id,
      milestoneId: treesMilestone.id,
      tagIds: [tags.dsa.id, tags.java.id, tags.college.id],
    }),
    task('Solve 3 array problems', 2000, {
      priority: 'medium',
      dueDate: today,
      estimateMin: 60,
      projectId: projects.dsa.id,
      milestoneId: milestones[0]?.id ?? null,
      tagIds: [tags.dsa.id],
    }),
    task('Submit OS lab record', 3000, {
      priority: 'urgent',
      dueDate: addDays(today, -2),
      estimateMin: 30,
      projectId: projects.semester.id,
      tagIds: [tags.college.id],
    }),
    task('Read chapter 4 of Designing Data-Intensive Applications', 4000, {
      priority: 'low',
      dueDate: addDays(today, 1),
      estimateMin: 40,
      tagIds: [tags.reading.id],
    }),
    task('Plan portfolio page structure', 5000, {
      dueDate: addDays(today, 4),
      projectId: projects.portfolio.id,
    }),
    task('Revise linked list reversal', 6000, {
      priority: 'medium',
      dueDate: addDays(today, 6),
      projectId: projects.dsa.id,
      milestoneId: milestones[1]?.id ?? null,
      tagIds: [tags.dsa.id],
    }),
    task('Set up Java project template', 7000, {
      status: 'done',
      completedAt: at - 86_400_000,
      projectId: projects.dsa.id,
      tagIds: [tags.java.id],
    }),
    task('Book dentist appointment', 8000, { tagIds: [tags.health.id] }),
  ]

  const habit = (
    name: string,
    color: string,
    order: number,
    extra: Partial<Habit> = {},
  ): Habit => ({
    id: newId(),
    ...base(at),
    name,
    color,
    cadence: 'daily',
    daysOfWeek: [],
    targetPerWeek: null,
    kind: 'binary',
    unit: null,
    target: null,
    sortOrder: order,
    archivedAt: null,
    ...extra,
  })

  const habits: Habit[] = [
    habit('Study', 'teal', 1000, { kind: 'quantity', unit: 'minutes', target: 90 }),
    habit('Exercise', 'green', 2000, { daysOfWeek: [1, 2, 3, 4, 5] }),
    habit('Reading', 'violet', 3000, { kind: 'quantity', unit: 'pages', target: 20 }),
  ]

  const habitEntries: HabitEntry[] = []
  for (let dayOffset = 9; dayOffset >= 0; dayOffset -= 1) {
    const date = addDays(today, -dayOffset)
    habits.forEach((h, index) => {
      // A plausible, imperfect history — a habit tracker with a flawless
      // streak is not a useful thing to look at while building the UI.
      if ((dayOffset + index) % 4 === 0) return
      habitEntries.push({
        id: newId(),
        ...base(at),
        habitId: h.id,
        date,
        value: h.kind === 'quantity' ? (h.target ?? 1) : 1,
        note: null,
      })
    })
  }

  // Every seeded note reserves its vault location, exactly as one created
  // through the UI does — so there is no such thing as a note without a path
  // waiting to be backfilled when sync arrives.
  const traversalNote: Note = {
    id: newId(),
    ...base(at),
    title: 'Binary tree traversal notes',
    body: '## Traversals\n\n- Inorder gives sorted output on a BST\n- Preorder is the one to use when copying a tree\n\n## Questions\n\n- When is Morris traversal actually worth it?\n',
    tagIds: [tags.dsa.id],
    vaultPath: buildVaultPath({ title: 'Binary tree traversal notes', tags: ['dsa'] }),
  }

  const looseNote: Note = {
    id: newId(),
    ...base(at),
    title: 'Reading list',
    body: '- [ ] Designing Data-Intensive Applications\n- [x] The Pragmatic Programmer\n',
    tagIds: [],
    vaultPath: buildVaultPath({ title: 'Reading list' }),
  }

  const notes: Note[] = [traversalNote, looseNote]

  // The note-to-entity relationship lives in its own table, so one note can
  // reference a task and the goal it serves at the same time.
  const noteLinks: NoteLink[] = (
    [
      {
        id: newId(),
        ...base(at),
        noteId: traversalNote.id,
        refType: 'task' as const,
        refId: tasks[0]?.id ?? '',
      },
      {
        id: newId(),
        ...base(at),
        noteId: traversalNote.id,
        refType: 'goal' as const,
        refId: goal.id,
      },
    ] satisfies NoteLink[]
  ).filter((link) => link.refId.length > 0)

  const seedEvent: AppEvent = {
    id: newId(),
    type: 'app.seeded',
    at,
    entityType: 'app',
    entityId: null,
    source: 'ui',
    payload: { tasks: tasks.length, projects: 3, habits: habits.length },
  }

  return {
    tags: Object.values(tags),
    goals: [goal],
    milestones,
    projects: Object.values(projects),
    tasks,
    habits,
    habitEntries,
    notes,
    noteLinks,
    events: [seedEvent],
    settings: [DEFAULT_SETTINGS(at)],
  }
}

/** Writes the seed only into an empty database. Never overwrites real data. */
export async function seedIfEmpty(db: VaultworkDatabase, now = new Date()): Promise<SeedResult> {
  if (!(await isDatabaseEmpty(db))) return { seeded: false, counts: {} }

  const data = buildSeed(now)
  await db.transaction(
    'rw',
    [
      db.tags,
      db.goals,
      db.milestones,
      db.projects,
      db.tasks,
      db.habits,
      db.habitEntries,
      db.notes,
      db.noteLinks,
      db.events,
      db.settings,
    ],
    async () => {
      await db.tags.bulkAdd(data.tags)
      await db.goals.bulkAdd(data.goals)
      await db.milestones.bulkAdd(data.milestones)
      await db.projects.bulkAdd(data.projects)
      await db.tasks.bulkAdd(data.tasks)
      await db.habits.bulkAdd(data.habits)
      await db.habitEntries.bulkAdd(data.habitEntries)
      await db.notes.bulkAdd(data.notes)
      await db.noteLinks.bulkAdd(data.noteLinks)
      await db.events.bulkAdd(data.events)
      const existing = await db.settings.get('singleton')
      if (!existing) await db.settings.add(data.settings[0] as Settings)
    },
  )

  return {
    seeded: true,
    counts: {
      tasks: data.tasks.length,
      projects: data.projects.length,
      goals: data.goals.length,
      milestones: data.milestones.length,
      habits: data.habits.length,
      habitEntries: data.habitEntries.length,
      notes: data.notes.length,
      noteLinks: data.noteLinks.length,
      tags: data.tags.length,
    },
  }
}
