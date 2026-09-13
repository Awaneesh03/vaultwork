import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/**
 * The last line of defence. A local-first app has no server to fall back on, so
 * a render error must not leave a blank page with the data still safely in
 * IndexedDB and no way to reach it.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 p-6">
        <h1 className="text-[18px] font-semibold">
          Vaultwork hit an error it could not recover from
        </h1>
        <p className="text-[13.5px] text-ink-2">
          Your data is untouched — it lives in this browser&rsquo;s IndexedDB, not in the screen
          that failed. Reloading is safe.
        </p>
        <pre className="overflow-x-auto rounded-md border border-line bg-surface p-3 font-mono text-[12px] text-ink-2">
          {error.message}
        </pre>
        <div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="h-9 rounded-md border border-line bg-surface px-3.5 text-[13.5px] hover:border-line-strong"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
