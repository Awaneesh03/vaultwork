import { useEffect, useRef } from 'react'
import { Bell, Check, Download, HardDrive, Monitor, Moon, Sun, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { DataView } from '@/components/feedback/DataView'
import { platform } from '@/platform'
import { APP_VERSION } from '@/lib/version'
import { useTheme } from '@/hooks/useTheme'
import { useSettings } from '@/hooks/useSettings'
import type { ThemePreference } from '@/types/enums'
import { PageHeader } from '@/components/ui/PageHeader'
import { useUiStore } from '@/store/uiStore'
import { useDataActions } from '../hooks/useDataActions'
import { useDiagnostics } from '../hooks/useDiagnostics'
import { AssistantSection } from '../components/AssistantSection'
import { DesktopSection } from '../components/DesktopSection'
import { TelegramSection } from '../components/TelegramSection'
import { useStorageReport } from '../hooks/useStorageReport'

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    /*
     * Each setting group is a card rather than a run of text separated by
     * rules. Settings is a screen people scan for one control, and a bounded
     * panel is far easier to skip past than a paragraph break.
     */
    <section className="flex flex-col gap-3.5 rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="flex flex-col gap-1">
        <h3 className="t-section text-ink">{title}</h3>
        {description ? <p className="t-meta max-w-prose text-ink-3">{description}</p> : null}
      </div>
      {children}
    </section>
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
  const storage = useStorageReport()
  const data = useDataActions()
  const diagnostics = useDiagnostics()
  const fileInput = useRef<HTMLInputElement>(null)

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

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Settings"
        description="Everything here is stored on this machine. Credentials live in the OS keychain and are never shown back to you."
      />

      <Section
        title="Appearance"
        description="System follows your OS and keeps following it — it is a preference, not a one-time read."
      >
        <div className="flex gap-2">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              variant={theme.preference === value ? 'primary' : 'secondary'}
              size="sm"
              icon={<Icon size={13} aria-hidden />}
              onClick={() => theme.setPreference(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          {(['comfortable', 'compact'] as const).map((density) => (
            <Button
              key={density}
              variant={theme.density === density ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => theme.setDensity(density)}
            >
              {density === 'comfortable' ? 'Comfortable rows' : 'Compact rows'}
            </Button>
          ))}
        </div>
      </Section>

      <Section
        title="Storage"
        description="IndexedDB can be evicted under storage pressure. Persistent storage asks the browser not to."
      >
        <DataView data={storage.report} isEmpty={() => false}>
          {(report) => (
            <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
              <div className="flex items-center gap-2">
                <HardDrive size={14} className="text-ink-3" aria-hidden />
                <span className="text-strong text-ink">
                  {report.persistence.persisted
                    ? 'Storage is persistent'
                    : 'Storage is not persistent'}
                </span>
                {report.persistence.persisted ? (
                  <Check size={14} className="text-ok" aria-hidden />
                ) : null}
              </div>
              {report.persistence.reason ? (
                <p className="text-body text-ink-3">{report.persistence.reason}</p>
              ) : null}
              {report.estimate ? (
                <p className="tabular font-mono text-body text-ink-3">
                  {formatBytes(report.estimate.usageBytes)} used of{' '}
                  {formatBytes(report.estimate.quotaBytes)}
                </p>
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
      </Section>

      <Section
        title="Backup"
        description="A downloaded file is the only backup that survives clearing site data. Snapshots live in the browser and protect against a bad import, not against a wipe."
      >
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
          <Button
            size="sm"
            icon={<Upload size={13} aria-hidden />}
            onClick={() => fileInput.current?.click()}
            disabled={data.state.busy}
          >
            Import JSON
          </Button>
          <Button size="sm" onClick={() => void data.snapshotNow()} disabled={data.state.busy}>
            Take snapshot
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void data.importFile(file)
              event.target.value = ''
            }}
          />
        </div>

        {data.state.message ? <p className="text-body text-ok">{data.state.message}</p> : null}
        {data.state.error ? <p className="text-body text-danger">{data.state.error}</p> : null}

        {data.snapshots && data.snapshots.length > 0 ? (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {data.snapshots.map((snapshot) => (
              <li key={snapshot.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="flex-1 font-mono text-body text-ink-2">{snapshot.id}</span>
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
          <p className="text-body text-ink-3">
            No snapshots yet. Snapshots are stored in{' '}
            {platform.snapshots.id === 'opfs'
              ? 'the Origin Private File System'
              : 'memory only (this browser has no OPFS)'}
            .
          </p>
        )}
      </Section>

      <Section
        title="Desktop"
        description="How Vaultwork behaves as a macOS application, separately from what it does once it is open."
      >
        <DesktopSection />
      </Section>

      <Section
        title="Notifications"
        description={
          capabilities.backgroundNotifications
            ? 'This is the desktop build, so a notification reaches your notification centre whether or not the window is open.'
            : 'A browser tab can only show a notification while it is open. The desktop build shows them properly.'
        }
      >
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
        <p className="text-body text-ink-3">
          One notification, sent now. Scheduling and reminder rules are a later milestone — this
          only proves the channel works.
        </p>
      </Section>

      <Section
        title="Assistant"
        description="An optional AI provider that can answer questions about your work and propose changes. It never changes anything on its own, and it stays switched off until you turn it on."
      >
        <AssistantSection />
      </Section>

      <Section
        title="Telegram"
        description="A private bot that can capture and complete tasks from your phone. Desktop only — a browser tab cannot hold a connection open."
      >
        <TelegramSection />
      </Section>

      <Section
        title="What this build can do"
        description="Read from the live platform adapters, so it always tells the truth about the build you are running."
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {Object.entries(capabilities).map(([name, enabled]) => (
            <div
              key={name}
              className="flex items-center justify-between gap-3 border-b border-line py-1.5"
            >
              <dt className="font-mono text-body text-ink-2">{name}</dt>
              <dd className={`font-mono text-meta ${enabled ? 'text-ok' : 'text-ink-3'}`}>
                {enabled ? 'yes' : 'no'}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-body text-ink-3">
          Vault access needs either the File System Access API, which only Chromium-based browsers
          have, or the desktop build, which needs no permission at all. Notifications and a native
          menu are desktop-only. Inbound messages need a running process, which a browser tab is not
          — Telegram is M14.
        </p>
      </Section>

      <Section title="About">
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

        {/*
          Diagnostics: runtime, database and storage persistence in one place.
          Deliberately the last thing on the last screen rather than anywhere a
          person writing a note would meet it — it answers "is my data actually
          safe here?", which is a question you go looking for.
        */}
        <details className="rounded-lg border border-line bg-surface">
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
      </Section>
    </div>
  )
}
