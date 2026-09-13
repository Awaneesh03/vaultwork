import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  Check,
  Download,
  HardDrive,
  Monitor,
  Moon,
  Sun,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { DataView } from '@/components/feedback/DataView'
import { platform } from '@/platform'
import { APP_VERSION } from '@/lib/version'
import { cn } from '@/lib/cn'
import { useTheme } from '@/hooks/useTheme'
import { useSettings } from '@/hooks/useSettings'
import type { ThemePreference } from '@/types/enums'
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader'
import { useUiStore } from '@/store/uiStore'
import { useDataActions } from '../hooks/useDataActions'
import { useDiagnostics } from '../hooks/useDiagnostics'
import { AssistantSection } from '../components/AssistantSection'
import { DesktopSection } from '../components/DesktopSection'
import { TelegramSection } from '../components/TelegramSection'
import { useStorageReport } from '../hooks/useStorageReport'
import { useWorkPreferences } from '../hooks/useWorkPreferences'

/**
 * Settings, grouped the way people look for things.
 *
 * Every group used to be an identically bordered card, which meant the screen
 * had eight things on it and no opinion about which mattered. Groups are now
 * bands under a rule, and a bordered panel is reserved for things that are
 * genuinely *objects* — a snapshot, a diagnostics dump, a state readout — so
 * that a border means "this is a thing" rather than "this is a heading".
 *
 * Nothing here reads a credential. The Assistant and Telegram sections show
 * state reported by the native side; the secrets themselves live in the OS
 * keychain and there is no command that reads them back.
 */

/** A band of related settings, under a rule rather than inside a box. */
function Group({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <SectionHeader label={title} />
        {description ? <p className="t-meta max-w-prose text-ink-3">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

/** One labelled control, with the sentence that explains it beneath. */
function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-strong font-medium text-ink">{label}</span>
      {children}
      {hint ? <p className="t-meta max-w-prose text-ink-3">{hint}</p> : null}
    </div>
  )
}

/** A row of mutually exclusive choices. Small, and never more than a handful. */
function Choice<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string; icon?: React.ReactNode }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-body',
              'transition-colors duration-[var(--duration-fast)]',
              active
                ? 'border-accent-line bg-accent-soft font-medium text-accent'
                : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** A bounded number, with its unit beside it. */
function Amount({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  unit: string
  onChange: (value: number) => void
}) {
  return (
    <label className="flex items-center gap-2 text-body text-ink-2">
      <span className="min-w-[7.5rem]">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        /*
         * Named explicitly. The wrapping label reads "Work 25 minutes" once the
         * value and the unit are inside it, which is not the name of the
         * control — it is the control, read aloud.
         */
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="tabular w-16 rounded-md border border-line-strong bg-surface px-2 py-1 text-body text-ink focus:border-accent"
      />
      <span className="text-meta text-ink-3">{unit}</span>
    </label>
  )
}

const THEMES: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function SettingsView() {
  const theme = useTheme()
  const settings = useSettings()
  const work = useWorkPreferences()
  const storage = useStorageReport()
  const data = useDataActions()
  const diagnostics = useDiagnostics()
  const fileInput = useRef<HTMLInputElement>(null)

  /**
   * The chosen file, held until it is confirmed.
   *
   * Importing calls `maintenanceRepo.replaceAll` — it does not merge, it
   * replaces every record in the database. That was a plain secondary button
   * sitting beside Export, which is an alarming thing to discover afterwards.
   * The picker still opens from both the button and the File menu; the gate is
   * after a file is chosen, where it can name the file and say what will
   * happen to it.
   */
  const [pendingImport, setPendingImport] = useState<File | null>(null)

  const menuRequest = useUiStore((s) => s.menuRequest)
  const clearMenuRequest = useUiStore((s) => s.clearMenuRequest)

  // Depends on the stable callback, not on `data`: see the note in
  // `useDataActions`. Depending on the object was an infinite loop.
  const { refreshSnapshots, exportNow } = data
  useEffect(() => {
    void refreshSnapshots()
  }, [refreshSnapshots])

  /**
   * File ▸ Export and File ▸ Import in the native menu.
   *
   * The menu navigates here and leaves a request; this presses the same two
   * controls a mouse would. That is the whole reason the request exists — one
   * implementation of "export", reachable two ways, rather than two
   * implementations that drift.
   */
  useEffect(() => {
    if (menuRequest === null) return
    clearMenuRequest()
    if (menuRequest === 'export') void exportNow()
    else if (menuRequest === 'import') fileInput.current?.click()
  }, [menuRequest, clearMenuRequest, exportNow])

  const capabilities = platform.capabilities
  const pomodoro = work.settings?.pomodoro

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader
        title="Settings"
        description="Everything here is stored on this machine. Credentials live in the OS keychain and are never shown back to you."
      />

      <Group
        title="Appearance"
        description="System follows your OS and keeps following it — it is a preference, not a one-time read."
      >
        <Field label="Theme">
          <Choice
            label="Theme"
            value={theme.preference}
            onChange={theme.setPreference}
            options={THEMES.map(({ value, label, icon: Icon }) => ({
              value,
              label,
              icon: <Icon size={13} aria-hidden />,
            }))}
          />
        </Field>

        <Field
          label="Row height"
          hint="Compact fits more on screen without changing any type size."
        >
          <Choice
            label="Row height"
            value={theme.density}
            onChange={theme.setDensity}
            options={[
              { value: 'comfortable' as const, label: 'Comfortable' },
              { value: 'compact' as const, label: 'Compact' },
            ]}
          />
        </Field>
      </Group>

      {/*
        Preferences that change how the rest of the application counts. These
        have been in the settings record — and read by Habits, the Dashboard
        and Focus — since those screens were built, with no way to change any
        of them. A streak that resets on the wrong day was a preference the
        user was simply not allowed to have.
      */}
      <Group
        title="Productivity"
        description="How Vaultwork measures a week, a day's work, and a focus session."
      >
        <Field
          label="Week starts on"
          hint="Used by habit streaks and the calendar. Changing it re-reads existing history rather than rewriting it."
        >
          <Choice
            label="Week starts on"
            value={work.settings?.weekStartsOn ?? 1}
            onChange={(value) => work.setWeekStart(value)}
            options={[
              { value: 1 as const, label: 'Monday' },
              { value: 0 as const, label: 'Sunday' },
            ]}
          />
        </Field>

        <Field label="Daily task goal" hint="What the dashboard measures the day against.">
          <Amount
            label="Tasks a day"
            value={work.settings?.dailyTaskGoal ?? 3}
            min={1}
            max={50}
            unit="tasks"
            onChange={work.setDailyTaskGoal}
          />
        </Field>

        {pomodoro ? (
          <Field label="Focus sessions" hint="The lengths the Focus screen offers.">
            <div className="flex flex-col gap-1.5">
              <Amount
                label="Work"
                value={pomodoro.workMin}
                min={1}
                max={180}
                unit="minutes"
                onChange={(workMin) => work.setPomodoro({ workMin })}
              />
              <Amount
                label="Short break"
                value={pomodoro.shortBreakMin}
                min={1}
                max={60}
                unit="minutes"
                onChange={(shortBreakMin) => work.setPomodoro({ shortBreakMin })}
              />
              <Amount
                label="Long break"
                value={pomodoro.longBreakMin}
                min={1}
                max={120}
                unit="minutes"
                onChange={(longBreakMin) => work.setPomodoro({ longBreakMin })}
              />
            </div>
          </Field>
        ) : null}
      </Group>

      <Group
        title="Assistant"
        description="An optional AI provider that can answer questions about your work and propose changes. It never changes anything on its own, and it stays switched off until you turn it on."
      >
        <AssistantSection />
      </Group>

      <Group
        title="Telegram"
        description="A private bot that can capture and complete tasks from your phone. Desktop only — a browser tab cannot hold a connection open."
      >
        <TelegramSection />
      </Group>

      <Group
        title="Desktop"
        description="How Vaultwork behaves as a macOS application, separately from what it does once it is open."
      >
        <DesktopSection />

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <span className="text-strong font-medium text-ink">Notifications</span>
          <p className="t-meta max-w-prose text-ink-3">
            {capabilities.backgroundNotifications
              ? 'This is the desktop build, so a notification reaches your notification centre whether or not the window is open.'
              : 'A browser tab can only show a notification while it is open. The desktop build shows them properly.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              icon={<Bell size={13} aria-hidden />}
              onClick={() => void diagnostics.testNotification()}
              disabled={diagnostics.busy}
            >
              Test notification
            </Button>
            {diagnostics.notice ? (
              <p
                className={`text-body ${diagnostics.notice.ok ? 'text-ok' : 'text-danger'}`}
                role="status"
              >
                {diagnostics.notice.text}
              </p>
            ) : null}
          </div>
          <p className="t-meta text-ink-3">
            One notification, sent now. Scheduling and reminder rules are a later milestone — this
            only proves the channel works.
          </p>
        </div>
      </Group>

      <Group
        title="Storage"
        description="IndexedDB can be evicted under storage pressure. Persistent storage asks the browser not to."
      >
        <DataView data={storage.report} isEmpty={() => false}>
          {(report) => (
            <div className="flex flex-col gap-2 panel p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <HardDrive size={14} className="shrink-0 text-ink-3" aria-hidden />
                <span className="text-strong text-ink">
                  {report.persistence.persisted
                    ? 'Storage is persistent'
                    : 'Storage is not persistent'}
                </span>
                {report.persistence.persisted ? (
                  <Check size={14} className="text-ok" aria-hidden />
                ) : null}
                {report.estimate ? (
                  <>
                    <span className="flex-1" />
                    <span className="tabular font-mono text-meta text-ink-3">
                      {formatBytes(report.estimate.usageBytes)} of{' '}
                      {formatBytes(report.estimate.quotaBytes)}
                    </span>
                  </>
                ) : null}
              </div>
              {report.persistence.reason ? (
                <p className="text-meta text-ink-3">{report.persistence.reason}</p>
              ) : null}
              {!report.persistence.persisted && report.persistence.supported ? (
                <div>
                  <Button size="sm" onClick={() => void storage.request()} disabled={storage.busy}>
                    Request persistent storage
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </DataView>

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <span className="text-strong font-medium text-ink">Backup</span>
          <p className="t-meta max-w-prose text-ink-3">
            A downloaded file is the only backup that survives clearing site data. Snapshots live in
            the browser and protect against a bad import, not against a wipe.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              icon={<Download size={13} aria-hidden />}
              onClick={() => void data.exportNow()}
              disabled={data.state.busy}
            >
              Export JSON
            </Button>
            <Button size="sm" onClick={() => void data.snapshotNow()} disabled={data.state.busy}>
              Take snapshot
            </Button>
            <span className="flex-1" />
            {/*
              Set apart from the two safe actions beside it, because it is not
              one of them: importing replaces every record in the database.
            */}
            <Button
              size="sm"
              variant="danger"
              icon={<Upload size={13} aria-hidden />}
              onClick={() => fileInput.current?.click()}
              disabled={data.state.busy}
            >
              Import JSON
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) setPendingImport(file)
                event.target.value = ''
              }}
            />
          </div>

          {pendingImport !== null ? (
            <div
              role="group"
              aria-label="Confirm import"
              className="flex flex-col gap-2 rounded-lg border-2 border-danger bg-surface p-3.5"
            >
              <p className="inline-flex items-start gap-1.5 text-strong font-medium text-danger">
                <AlertTriangle size={13} className="mt-[3px] shrink-0" aria-hidden />
                Replace everything with this file?
              </p>
              <p className="max-w-prose text-body text-ink-2">
                Importing does not merge. Every task, project, goal, habit, note and document in
                Vaultwork is replaced by what is in{' '}
                <span className="font-mono text-ink">{pendingImport.name}</span>. A snapshot is
                taken first, so this can be undone from the list below.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={data.state.busy}
                  onClick={() => {
                    const file = pendingImport
                    setPendingImport(null)
                    void data.importFile(file)
                  }}
                >
                  Replace my data
                </Button>
                {/*
                  A full secondary, not a ghost. The confirmation card in the
                  Assistant settled this already: backing out of something
                  destructive must never be the harder of the two to find.
                */}
                <Button size="sm" variant="secondary" onClick={() => setPendingImport(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {data.state.message ? <p className="text-body text-ok">{data.state.message}</p> : null}
          {data.state.error ? <p className="text-body text-danger">{data.state.error}</p> : null}

          {data.snapshots && data.snapshots.length > 0 ? (
            <ul className="divide-y divide-line panel">
              {data.snapshots.map((snapshot) => (
                <li key={snapshot.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-body text-ink-2">
                    {snapshot.id}
                  </span>
                  <span className="tabular font-mono text-meta text-ink-3">
                    {formatBytes(snapshot.bytes)}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => void data.restore(snapshot.id)}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-meta text-ink-3">
              No snapshots yet. Snapshots are stored in{' '}
              {platform.snapshots.id === 'opfs'
                ? 'the Origin Private File System'
                : 'memory only (this browser has no OPFS)'}
              .
            </p>
          )}
        </div>
      </Group>

      <Group title="About">
        <dl className="flex flex-col gap-1.5 font-mono text-body text-ink-2">
          <div className="flex justify-between">
            <dt>app version</dt>
            <dd className="text-ink">{APP_VERSION}</dd>
          </div>
          <div className="flex justify-between">
            <dt>schema version</dt>
            <dd className="text-ink">{settings?.schemaVersion ?? '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt>file system adapter</dt>
            <dd className="text-ink">{platform.fileSystem.id}</dd>
          </div>
          <div className="flex justify-between">
            <dt>telegram</dt>
            <dd className="text-ink">{platform.telegram.id}</dd>
          </div>
        </dl>

        <details className="panel">
          <summary className="cursor-pointer px-3.5 py-2.5 text-body text-ink-2">
            What this build can do
          </summary>
          <div className="border-t border-line px-3.5 py-3">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {Object.entries(capabilities).map(([name, enabled]) => (
                <div
                  key={name}
                  className="flex items-center justify-between gap-3 border-b border-line py-1"
                >
                  <dt className="font-mono text-body text-ink-2">{name}</dt>
                  <dd className={`font-mono text-meta ${enabled ? 'text-ok' : 'text-ink-3'}`}>
                    {enabled ? 'yes' : 'no'}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-meta text-ink-3">
              Read from the live platform adapters, so it always tells the truth about the build you
              are running. Vault access needs either the File System Access API, which only
              Chromium-based browsers have, or the desktop build, which needs no permission at all.
            </p>
          </div>
        </details>

        {/*
          Diagnostics: runtime, database and storage persistence in one place.
          Deliberately the last thing on the last screen rather than anywhere a
          person writing a note would meet it — it answers "is my data actually
          safe here?", which is a question you go looking for.
        */}
        <details className="panel">
          <summary className="cursor-pointer px-3.5 py-2.5 text-body text-ink-2">
            Diagnostics
          </summary>
          <div className="border-t border-line px-3.5 py-3">
            {diagnostics.report === undefined ? (
              <p className="text-body text-ink-3">Reading…</p>
            ) : (
              <dl className="flex flex-col gap-1.5 font-mono text-body text-ink-2">
                <div className="flex justify-between gap-3">
                  <dt>runtime</dt>
                  <dd className="text-ink">{diagnostics.report.runtime}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>vault adapter</dt>
                  <dd className="text-ink">{diagnostics.report.vaultAdapter}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>notifications</dt>
                  <dd className="text-ink">{diagnostics.report.notificationAdapter}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>database</dt>
                  <dd className="text-ink">
                    {diagnostics.report.database.name} v{diagnostics.report.database.schemaVersion}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>records</dt>
                  <dd className="tabular text-ink">{diagnostics.report.database.records}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>storage persisted</dt>
                  <dd
                    className={
                      diagnostics.report.storage.persistence.persisted ? 'text-ok' : 'text-ink-3'
                    }
                  >
                    {diagnostics.report.storage.persistence.persisted ? 'yes' : 'no'}
                  </dd>
                </div>
                {diagnostics.report.storage.usedBytes !== null ? (
                  <div className="flex justify-between gap-3">
                    <dt>storage used</dt>
                    <dd className="tabular text-ink">
                      {formatBytes(diagnostics.report.storage.usedBytes)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            )}
          </div>
        </details>
      </Group>
    </div>
  )
}
