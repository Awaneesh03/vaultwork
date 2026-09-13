import 'fake-indexeddb/auto'

/**
 * Tests run against a real IndexedDB implementation (fake-indexeddb), not a
 * mock of Dexie. A mocked persistence layer would pass while the indexes,
 * unique constraints and transaction semantics — the parts most likely to be
 * wrong — went untested.
 *
 * TZ is pinned to Asia/Kolkata (UTC+05:30) in the test script so the date
 * convention tests actually catch a UTC-based implementation. Under TZ=UTC they
 * would pass either way.
 */

import { afterEach } from 'vitest'

/**
 * Unmounts anything a DOM test rendered.
 *
 * Testing Library only registers this itself when Vitest runs with `globals`,
 * which this project does not — so without it every `render` piles onto the
 * previous one and `getByRole` starts finding two of everything. The import is
 * dynamic because most suites run in the `node` environment, where
 * @testing-library/react has no document to load against.
 */
afterEach(async () => {
  if (typeof document === 'undefined') return
  const { cleanup } = await import('@testing-library/react')
  cleanup()
})
