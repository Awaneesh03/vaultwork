import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { platform } from '@/platform'
import { eventBus } from './eventBus'
import { startMcpSnapshotWriter } from './mcpSnapshotService'
import { resetDatabase } from '../../tests/helpers'

/**
 * The writer's scheduling, which is the part with a way to be wrong.
 *
 * The projection itself is covered end to end in `tests/mcp.test.ts`; what is
 * checked here is that a burst of mutations costs one write, that a browser
 * build writes nothing at all, and that stopping actually stops.
 */
describe('the MCP snapshot writer', () => {
  let written: string[]

  beforeEach(async () => {
    await resetDatabase()
    written = []
    // A desktop build, faked at the port — the same seam every other adapter
    // test uses, so no runtime detection is involved.
    vi.spyOn(platform.desktop, 'isSupported', 'get').mockReturnValue(true)
    vi.spyOn(platform.desktop, 'writeMcpSnapshot').mockImplementation(async (json: string) => {
      written.push(json)
    })
  })

  afterEach(async () => {
    eventBus.clearListeners()
    await resetDatabase()
  })

  const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  it('writes once at start-up, before anything has changed', async () => {
    const stop = startMcpSnapshotWriter(10)
    await settle(30)
    stop()

    expect(written).toHaveLength(1)
    expect(JSON.parse(written[0] ?? '{}')).toMatchObject({ schemaVersion: 1 })
  })

  it('collapses a burst of mutations into one write', async () => {
    const stop = startMcpSnapshotWriter(30)
    await settle(20)
    const atStart = written.length

    for (let index = 0; index < 5; index += 1) {
      await eventBus.emit({
        type: 'task.created',
        entityType: 'task',
        entityId: `task-${index}`,
        source: 'ui',
      })
    }
    await settle(120)
    stop()

    // Five events, one extra write: the debounce is doing its job rather than
    // turning every keystroke-sized change into a disk write.
    expect(written.length - atStart).toBe(1)
  })

  it('stops writing once it is stopped', async () => {
    const stop = startMcpSnapshotWriter(20)
    await settle(20)
    stop()
    const afterStop = written.length

    await eventBus.emit({
      type: 'task.created',
      entityType: 'task',
      entityId: 'task-late',
      source: 'ui',
    })
    await settle(80)

    expect(written).toHaveLength(afterStop)
  })

  it('writes nothing in a build with no desktop', async () => {
    vi.spyOn(platform.desktop, 'isSupported', 'get').mockReturnValue(false)

    const stop = startMcpSnapshotWriter(10)
    await eventBus.emit({
      type: 'task.created',
      entityType: 'task',
      entityId: 'task-1',
      source: 'ui',
    })
    await settle(40)
    stop()

    expect(written).toHaveLength(0)
  })
})
