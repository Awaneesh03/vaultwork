/**
 * Which runtime this build is executing in.
 *
 * One module knows how the question is answered, and it is this one. Scattering
 * `if (window.__TAURI__)` through the application would mean every feature
 * carried a little piece of platform knowledge, and adding a third runtime
 * later would mean finding all of them. Everything above `platform/` asks about
 * *capabilities* instead — "can this build write to a vault?" — which is the
 * question a feature actually has.
 */

export type RuntimeKind = 'browser' | 'tauri'

/**
 * Tauri v2 injects `__TAURI_INTERNALS__` into the WebView before any
 * application script runs.
 *
 * `__TAURI__` is *not* checked: that global only exists when
 * `withGlobalTauri` is enabled in the config, which this build does not do —
 * relying on it would make runtime detection depend on a bundler setting.
 */
function detect(): RuntimeKind {
  if (typeof globalThis === 'undefined') return 'browser'
  return '__TAURI_INTERNALS__' in globalThis ? 'tauri' : 'browser'
}

/**
 * Resolved once, at module load.
 *
 * The runtime cannot change while the process is alive, and a cached answer
 * means no hot path ever probes a global. Tests that need the other branch call
 * `setRuntimeForTesting`.
 */
let current: RuntimeKind = detect()

export function currentRuntime(): RuntimeKind {
  return current
}

export function isTauri(): boolean {
  return current === 'tauri'
}

export function isBrowser(): boolean {
  return current === 'browser'
}

/**
 * Overrides detection. Tests only.
 *
 * Exported from `platform/runtime` rather than `platform/index` so it never
 * appears in the barrel a service imports — a service that could change the
 * runtime is a service that could lie about it.
 */
export function setRuntimeForTesting(kind: RuntimeKind | null): void {
  current = kind ?? detect()
}
