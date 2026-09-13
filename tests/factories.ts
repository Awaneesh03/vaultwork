import type { CreateInput } from '@/repositories'

/** A complete, valid task with only the interesting fields spelled out. */
export function taskInput(overrides: Partial<CreateInput<'tasks'>> = {}): CreateInput<'tasks'> {
  return {
    title: 'Study Binary Trees',
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
    sortOrder: 1000,
    completedAt: null,
    reminderAt: null,
    vaultPath: null,
    ...overrides,
  }
}

export function projectInput(
  overrides: Partial<CreateInput<'projects'>> = {},
): CreateInput<'projects'> {
  return {
    name: 'DSA Mastery',
    description: null,
    color: 'teal',
    icon: 'binary',
    status: 'active',
    deadline: null,
    goalId: null,
    tagIds: [],
    sortOrder: 1000,
    vaultPath: null,
    ...overrides,
  }
}

export function subtaskInput(
  taskId: string,
  overrides: Partial<CreateInput<'subtasks'>> = {},
): CreateInput<'subtasks'> {
  return {
    taskId,
    title: 'Inorder traversal',
    done: false,
    sortOrder: 1000,
    ...overrides,
  }
}

export function tagInput(overrides: Partial<CreateInput<'tags'>> = {}): CreateInput<'tags'> {
  return { name: 'dsa', color: null, ...overrides }
}
