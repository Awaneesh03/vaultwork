import {
  BarChart3,
  Bot,
  CalendarDays,
  CheckCircle2,
  FileText,
  FileType2,
  FolderKanban,
  Gauge,
  Inbox,
  ListChecks,
  Repeat,
  Sparkles,
  Sun,
  Target,
  Timer,
  TriangleAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
  /** Displayed next to the item and bound in useGlobalShortcuts. */
  shortcut?: string
  description: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

/**
 * The eleven sections grouped by how often you look at them, which is the only
 * grouping that helps: a flat list of eleven equal items is a menu, not a
 * command centre.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Daily',
    items: [
      { path: '/', label: 'Dashboard', icon: Gauge, shortcut: 'G D', description: 'What now?' },
      {
        path: '/inbox',
        label: 'Inbox',
        icon: Inbox,
        shortcut: 'G I',
        description: 'Uncategorised capture',
      },
      { path: '/today', label: 'Today', icon: Sun, shortcut: 'T', description: "Today's plan" },
      {
        path: '/upcoming',
        label: 'Upcoming',
        icon: CalendarDays,
        shortcut: 'U',
        description: 'The next two weeks',
      },
      {
        path: '/overdue',
        label: 'Overdue',
        icon: TriangleAlert,
        description: 'Past their date, still open',
      },
      {
        path: '/tasks',
        label: 'All tasks',
        icon: ListChecks,
        description: 'Everything, filterable',
      },
      {
        path: '/completed',
        label: 'Completed',
        icon: CheckCircle2,
        description: 'What you finished',
      },
    ],
  },
  {
    label: 'Structure',
    items: [
      {
        path: '/projects',
        label: 'Projects',
        icon: FolderKanban,
        shortcut: 'P',
        description: 'Work with a lifecycle',
      },
      {
        path: '/goals',
        label: 'Goals',
        icon: Target,
        shortcut: 'G G',
        description: 'Long-horizon intent',
      },
      {
        path: '/habits',
        label: 'Habits',
        icon: Repeat,
        shortcut: 'H',
        description: 'Streaks and routines',
      },
      {
        path: '/calendar',
        label: 'Calendar',
        icon: CalendarDays,
        shortcut: 'C',
        description: 'Month, week, day',
      },
    ],
  },
  {
    label: 'Reflect',
    items: [
      {
        path: '/ai',
        label: 'Assistant',
        icon: Bot,
        shortcut: 'G A',
        description: 'Ask, then confirm',
      },
      {
        path: '/focus',
        label: 'Focus',
        icon: Timer,
        shortcut: 'F',
        description: 'Pomodoro sessions',
      },
      {
        path: '/analytics',
        label: 'Analytics',
        icon: BarChart3,
        shortcut: 'A',
        description: 'What the event log knows',
      },
      {
        path: '/notes',
        label: 'Notes',
        icon: FileText,
        shortcut: 'G N',
        description: 'Markdown, attached',
      },
      {
        /*
         * No chord. Every mnemonic letter is taken — `G D` is the Dashboard,
         * `G O` is Obsidian, `G N` is Notes — and advertising a key that goes
         * somewhere else is worse than advertising none. It had been showing
         * `G D`, which navigated to the Dashboard.
         */
        path: '/documents',
        label: 'Documents',
        icon: FileType2,
        description: 'PDFs from your vault',
      },
      {
        path: '/obsidian',
        label: 'Obsidian',
        icon: Sparkles,
        shortcut: 'G O',
        description: 'Vault status and sync',
      },
    ],
  },
]

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items)

export const SETTINGS_ITEM: NavItem = {
  path: '/settings',
  label: 'Settings',
  icon: CheckCircle2,
  description: 'Theme, data and storage',
}

/**
 * Every route the application can navigate to, in one place.
 *
 * The UI layer builds links from these rather than from string literals, so a
 * screen cannot invent a route that does not exist and a rename is one edit.
 * `app/` may not import a service value, which is why the task paths are
 * spelled out here rather than imported from `TASK_VIEW_PATHS` —
 * `tests/architecture.test.ts` asserts the two agree, so drift fails CI rather
 * than a keypress.
 */
export const ROUTES = {
  dashboard: '/',
  inbox: '/inbox',
  today: '/today',
  upcoming: '/upcoming',
  overdue: '/overdue',
  completed: '/completed',
  allTasks: '/tasks',
  projects: '/projects',
  calendar: '/calendar',
  habits: '/habits',
  goals: '/goals',
  notes: '/notes',
  noteGraph: '/notes/graph',
  ai: '/ai',
  obsidian: '/obsidian',
  obsidianSync: '/obsidian/sync',
  settings: '/settings',
  /** One project's own screen. */
  project: (id: string) => `/projects/${id}`,
  /** One note's own screen. */
  note: (id: string) => `/notes/${id}`,
} as const

/**
 * The routes that render the task screen — the ones with a quick add bar.
 *
 * Derived from `ROUTES` rather than written out again, so the keyboard layer
 * and the link targets cannot disagree with each other.
 */
export const TASK_ROUTES = [
  ROUTES.inbox,
  ROUTES.today,
  ROUTES.upcoming,
  ROUTES.overdue,
  ROUTES.completed,
  ROUTES.allTasks,
] as const

/**
 * The two shapes a project URL takes.
 *
 * The shortcut layer has to tell them apart: on the list, "N" means a new
 * project; inside one, it means capture a task into it.
 */
export const GOALS_ROUTE = ROUTES.goals
export const NOTES_ROUTE = ROUTES.notes

export const PROJECTS_ROUTE = ROUTES.projects
export const PROJECT_DETAIL_RE = /^\/projects\/[^/]+$/

/**
 * Screens that own a quick add bar without being a task route.
 *
 * "N captures here" is a property of the screen, not of the route family, and
 * the shortcut layer needs the distinction: on one of these, N focuses the
 * capture bar in place; anywhere else it has to go find one.
 */
export const CAPTURE_ROUTES = [ROUTES.calendar] as const
