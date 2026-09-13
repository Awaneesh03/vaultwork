import {
  Binary,
  BookOpen,
  Briefcase,
  Code2,
  Dumbbell,
  Folder,
  Globe,
  GraduationCap,
  Home,
  Rocket,
  Target,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { ProjectStatus } from '@/types/enums'

/**
 * How a project looks, resolved from the two strings it stores.
 *
 * A project's `color` is a *name* ("teal"), not a hex value, because a name
 * survives a theme change and a hex value does not. The name resolves to a CSS
 * variable defined in `styles/tokens.css`, so this file contains no colours at
 * all — which is what stops eight project accents turning into eight hard-coded
 * literals scattered through the components that draw them.
 */

export const PROJECT_COLORS = [
  'teal',
  'mint',
  'green',
  'amber',
  'rose',
  'violet',
  'blue',
  'slate',
] as const

export type ProjectColor = (typeof PROJECT_COLORS)[number]

/**
 * What the composer starts a new project with.
 *
 * These agree with `projectService`'s own defaults by assertion rather than by
 * import: the UI layer may not import a service value, so the two constants are
 * held in step by `projectAppearance.test.ts` instead of by a shared module.
 */
export const DEFAULT_PROJECT_COLOR: ProjectColor = 'teal'

export const PROJECT_COLOR_LABELS: Record<ProjectColor, string> = {
  teal: 'Teal',
  mint: 'Mint',
  green: 'Green',
  amber: 'Amber',
  rose: 'Rose',
  violet: 'Violet',
  blue: 'Blue',
  slate: 'Slate',
}

export function isProjectColor(value: string): value is ProjectColor {
  return (PROJECT_COLORS as readonly string[]).includes(value)
}

/**
 * The CSS value for a stored colour name.
 *
 * An unknown name falls back to the accent rather than to `transparent`: a
 * project imported from a backup written by a later version should look plain,
 * not invisible.
 */
export function projectColorVar(color: string): string {
  return isProjectColor(color) ? `var(--project-${color})` : 'var(--accent)'
}

/** Icons a project can choose from. `folder` is the default and the fallback. */
export const PROJECT_ICONS = [
  'folder',
  'binary',
  'code',
  'graduation-cap',
  'book',
  'globe',
  'rocket',
  'target',
  'briefcase',
  'dumbbell',
  'home',
  'wallet',
] as const

export type ProjectIconName = (typeof PROJECT_ICONS)[number]

export const DEFAULT_PROJECT_ICON: ProjectIconName = 'folder'

const ICONS: Record<ProjectIconName, LucideIcon> = {
  folder: Folder,
  binary: Binary,
  code: Code2,
  'graduation-cap': GraduationCap,
  book: BookOpen,
  globe: Globe,
  rocket: Rocket,
  target: Target,
  briefcase: Briefcase,
  dumbbell: Dumbbell,
  home: Home,
  wallet: Wallet,
}

export const PROJECT_ICON_LABELS: Record<ProjectIconName, string> = {
  folder: 'Folder',
  binary: 'Binary',
  code: 'Code',
  'graduation-cap': 'Study',
  book: 'Reading',
  globe: 'Web',
  rocket: 'Launch',
  target: 'Goal',
  briefcase: 'Work',
  dumbbell: 'Fitness',
  home: 'Home',
  wallet: 'Money',
}

export function projectIcon(name: string): LucideIcon {
  return ICONS[name as ProjectIconName] ?? Folder
}

// -------------------------------------------------------------------- status

/** The five statuses, in lifecycle order rather than alphabetical. */
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  archived: 'Archived',
}

/**
 * The statuses the composer offers.
 *
 * `archived` is deliberately absent: archiving is an action with its own event
 * and its own undo, not a value you pick from a dropdown. Letting it be set
 * here would produce a `project.updated` where a `project.archived` belongs.
 */
export const EDITABLE_PROJECT_STATUSES: ProjectStatus[] = [
  'planning',
  'active',
  'on_hold',
  'completed',
]
