import { Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { AiView } from '@/features/ai/views/AiView'
import { AnalyticsView } from '@/features/analytics/views/AnalyticsView'
import { CalendarView } from '@/features/calendar/views/CalendarView'
import { DashboardView } from '@/features/dashboard/views/DashboardView'
import { FocusView } from '@/features/focus/views/FocusView'
import { GoalsView } from '@/features/goals/views/GoalsView'
import { HabitsView } from '@/features/habits/views/HabitsView'
import { InboxView } from '@/features/inbox/views/InboxView'
import { NoteDetailView } from '@/features/notes/views/NoteDetailView'
import { NoteGraphView } from '@/features/notes/views/NoteGraphView'
import { NotesView } from '@/features/notes/views/NotesView'
import { DocumentsView } from '@/features/documents/views/DocumentsView'
import { ObsidianView } from '@/features/obsidian/views/ObsidianView'
import { SyncCenterView } from '@/features/obsidian/views/SyncCenterView'
import { ProjectDetailView } from '@/features/projects/views/ProjectDetailView'
import { ProjectsView } from '@/features/projects/views/ProjectsView'
import { SettingsView } from '@/features/settings/views/SettingsView'
import { AllTasksView } from '@/features/tasks/views/AllTasksView'
import { CompletedView } from '@/features/tasks/views/CompletedView'
import { OverdueView } from '@/features/tasks/views/OverdueView'
import { TodayView } from '@/features/today/views/TodayView'
import { UpcomingView } from '@/features/upcoming/views/UpcomingView'

function NotFound() {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-display font-semibold tracking-tight">No such screen</h2>
      <p className="text-strong text-ink-2">
        That route does not exist. Press ⌘K to jump somewhere that does.
      </p>
    </div>
  )
}

/** Every route is URL-addressable, so back, forward and bookmarks all work. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardView />} />
        <Route path="inbox" element={<InboxView />} />
        <Route path="today" element={<TodayView />} />
        <Route path="upcoming" element={<UpcomingView />} />
        <Route path="overdue" element={<OverdueView />} />
        <Route path="completed" element={<CompletedView />} />
        <Route path="tasks" element={<AllTasksView />} />
        <Route path="projects" element={<ProjectsView />} />
        <Route path="projects/:projectId" element={<ProjectDetailView />} />
        <Route path="calendar" element={<CalendarView />} />
        <Route path="habits" element={<HabitsView />} />
        <Route path="goals" element={<GoalsView />} />
        <Route path="focus" element={<FocusView />} />
        <Route path="analytics" element={<AnalyticsView />} />
        <Route path="ai" element={<AiView />} />
        <Route path="notes" element={<NotesView />} />
        {/* Declared before the :noteId route so "graph" is not read as an id. */}
        <Route path="notes/graph" element={<NoteGraphView />} />
        <Route path="notes/:noteId" element={<NoteDetailView />} />
        <Route path="documents" element={<DocumentsView />} />
        <Route path="obsidian" element={<ObsidianView />} />
        <Route path="obsidian/sync" element={<SyncCenterView />} />
        <Route path="settings" element={<SettingsView />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
