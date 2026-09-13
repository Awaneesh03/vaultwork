import { afterEach, describe, expect, it } from 'vitest'
import { currentRuntime, isBrowser, isTauri, setRuntimeForTesting } from './runtime'

/**
 * Runtime detection lives in exactly one module, which is the point of it.
 * `tests/architecture.test.ts` asserts nothing else probes the global; this
 * asserts the module itself answers correctly.
 */

afterEach(() => {
  setRuntimeForTesting(null)
  delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__
})

describe('runtime detection', () => {
  it('reports a browser when Tauri has injected nothing', () => {
    expect(currentRuntime()).toBe('browser')
    expect(isBrowser()).toBe(true)
    expect(isTauri()).toBe(false)
  })

  it('reports Tauri when the internals global is present', () => {
    ;(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    setRuntimeForTesting(null)

    expect(currentRuntime()).toBe('tauri')
    expect(isTauri()).toBe(true)
    expect(isBrowser()).toBe(false)
  })

  it('ignores __TAURI__, which only exists when withGlobalTauri is set', () => {
    // Detecting on that global would make the runtime depend on a bundler
    // option rather than on the runtime.
    ;(globalThis as Record<string, unknown>).__TAURI__ = {}
    setRuntimeForTesting(null)

    expect(currentRuntime()).toBe('browser')
    delete (globalThis as Record<string, unknown>).__TAURI__
  })

  it('can be forced, for tests that need the other branch', () => {
    setRuntimeForTesting('tauri')
    expect(isTauri()).toBe(true)

    setRuntimeForTesting('browser')
    expect(isTauri()).toBe(false)

    setRuntimeForTesting(null)
    expect(currentRuntime()).toBe('browser')
  })

  it('answers the same way every time, rather than re-probing on each call', () => {
    expect(currentRuntime()).toBe('browser')
    ;(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {}

    // Resolved once at load: a runtime cannot change under a running process,
    // and a cached answer keeps it off every hot path.
    expect(currentRuntime()).toBe('browser')
  })
})
