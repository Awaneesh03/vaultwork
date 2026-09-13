import { BrowserRouter } from 'react-router-dom'
import { ErrorBoundary } from './ErrorBoundary'
import { AppRoutes } from './router'
import { useBootstrap } from './hooks/useBootstrap'
import { useTheme } from '@/hooks/useTheme'

function BootScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <p className="font-mono text-body text-ink-3">{message}</p>
    </div>
  )
}

function BootFailure({ error }: { error: Error }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 p-6">
      <h1 className="text-display font-semibold">Vaultwork could not open its database</h1>
      <p className="text-strong text-ink-2">
        Everything lives in this browser, so without IndexedDB there is nothing to show.
      </p>
      <pre className="overflow-x-auto rounded-md border border-line bg-surface p-3 font-mono text-body text-ink-2">
        {error.message}
      </pre>
    </div>
  )
}

/** Applies the theme as soon as settings load, independently of routing. */
function ThemeEffect() {
  useTheme()
  return null
}

export function App() {
  const boot = useBootstrap()

  if (boot.status === 'loading') return <BootScreen message="Opening database…" />
  if (boot.status === 'failed') return <BootFailure error={boot.error} />

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ThemeEffect />
        <AppRoutes />
      </BrowserRouter>
    </ErrorBoundary>
  )
}
