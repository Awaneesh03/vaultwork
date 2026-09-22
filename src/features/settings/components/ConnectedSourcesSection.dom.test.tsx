import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { platform } from '@/platform'
import { ConnectedSourcesSection } from './ConnectedSourcesSection'

/**
 * The readout on screen (M18.4). Each row answers on its own, so an
 * integration whose status never arrives costs its row and nothing else — the
 * same promise Settings already keeps for Telegram.
 */

const mount = () =>
  render(
    <MemoryRouter>
      <ConnectedSourcesSection />
    </MemoryRouter>,
  )

describe('Connected sources', () => {
  const realTelegram = platform.telegram
  afterEach(() => {
    Object.defineProperty(platform, 'telegram', { value: realTelegram, configurable: true })
  })

  it('lists every source with its status in words, not only colour', async () => {
    mount()
    const list = screen.getByRole('list', { name: 'Connected sources' })
    expect(await within(list).findByRole('listitem', { name: 'Vaultwork: Available' })).toBeTruthy()
    // In the browser runtime the desktop-only sources say so plainly.
    expect(
      await within(list).findByRole('listitem', {
        name: 'Claude Desktop (MCP): Not in this build',
      }),
    ).toBeTruthy()
    expect(within(list).getByText('Read · Write · Search')).toBeTruthy()
  })

  it('never lets one hung integration hold up the others', async () => {
    Object.defineProperty(platform, 'telegram', {
      value: { ...realTelegram, isSupported: true, status: () => new Promise(() => {}) },
      configurable: true,
    })
    mount()

    const list = screen.getByRole('list', { name: 'Connected sources' })
    expect(await within(list).findByRole('listitem', { name: 'Vaultwork: Available' })).toBeTruthy()
    expect(await within(list).findByRole('listitem', { name: /Obsidian:/ })).toBeTruthy()
    // Only Telegram's row is still waiting.
    const waiting = within(list)
      .getAllByRole('listitem')
      .filter((row) => row.getAttribute('aria-busy') === 'true')
    expect(waiting).toHaveLength(1)
    expect(waiting[0]?.textContent).toBe('Checking…')
  })

  it('links to where Obsidian is actually managed, and offers no controls of its own', async () => {
    mount()
    const list = screen.getByRole('list', { name: 'Connected sources' })
    await within(list).findByRole('listitem', { name: 'Vaultwork: Available' })
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/obsidian'])
    // A readout: no button inside the list connects, sends or changes anything.
    expect(within(list).queryAllByRole('button')).toEqual([])
  })
})
