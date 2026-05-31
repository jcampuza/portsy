import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PortsyPanel, getEntryDisplayName, parseProcessNames, parseRanges } from './PortsyPanel'
import { defaultSettings, type PortEntry, type PortSnapshot } from '../lib/types'

const baseEntry: PortEntry = {
  protocol: 'tcp',
  port: 5173,
  pid: 123,
  processName: 'node',
  command: 'node ./node_modules/.bin/vite --port 5173',
  user: 'joseph',
  bindAddresses: ['127.0.0.1'],
  killDisabledReason: null,
}

function snapshot(entries: PortEntry[]): PortSnapshot {
  return {
    scannedAtMs: 1,
    ranges: defaultSettings.ranges,
    entries,
  }
}

function renderPanel(entries: PortEntry[] = []) {
  return render(
    <PortsyPanel
      snapshot={snapshot(entries)}
      settings={defaultSettings}
      loading={false}
      message={null}
      onRefresh={vi.fn()}
      onKillPort={vi.fn().mockResolvedValue({
        port: 5173,
        pid: 123,
        processName: 'node',
        terminated: true,
        forced: false,
        message: 'Sent SIGTERM and the port was released.',
      })}
      onKillAll={vi.fn().mockResolvedValue([])}
      onSaveSettings={vi.fn().mockImplementation(async (settings) => settings)}
    />,
  )
}

afterEach(() => {
  cleanup()
})

describe('PortsyPanel', () => {
  it('renders the empty state', () => {
    renderPanel()

    expect(screen.getByText('No watched TCP listeners found.')).toBeTruthy()
  })

  it('renders a populated port row', () => {
    renderPanel([baseEntry])

    expect(screen.getByText('5173')).toBeTruthy()
    expect(screen.getAllByText('node').length).toBeGreaterThan(0)
    expect(screen.getByText('PID 123')).toBeTruthy()
  })

  it('disables kill for protected rows', () => {
    renderPanel([
      {
        ...baseEntry,
        killDisabledReason: 'Root-owned process; Portsy will not request sudo.',
      },
    ])

    expect(screen.getByRole('button', { name: 'Kill' })).toHaveProperty('disabled', true)
    expect(screen.getByText('Root-owned process; Portsy will not request sudo.')).toBeTruthy()
  })

  it('confirms kill all before invoking the action', async () => {
    const onKillAll = vi.fn().mockResolvedValue([
      {
        ok: true,
        report: {
          port: 5173,
          pid: 123,
          processName: 'node',
          terminated: true,
          forced: false,
          message: 'done',
        },
        error: null,
      },
    ])

    render(
      <PortsyPanel
        snapshot={snapshot([baseEntry])}
        settings={defaultSettings}
        loading={false}
        message={null}
        onRefresh={vi.fn()}
        onKillPort={vi.fn()}
        onKillAll={onKillAll}
        onSaveSettings={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Kill All Watched' }))
    expect(onKillAll).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(onKillAll).toHaveBeenCalledOnce())
  })

  it('opens settings as a separate view with a back button', () => {
    renderPanel([baseEntry])

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(screen.queryByLabelText('Watched ports')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Watched ports')).toBeTruthy()
  })

  it('saves the keep-open development setting', async () => {
    const onSaveSettings = vi.fn().mockImplementation(async (settings) => settings)

    render(
      <PortsyPanel
        snapshot={snapshot([])}
        settings={defaultSettings}
        loading={false}
        message={null}
        onRefresh={vi.fn()}
        onKillPort={vi.fn()}
        onKillAll={vi.fn()}
        onSaveSettings={onSaveSettings}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByLabelText('Keep open when unfocused'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))

    await waitFor(() =>
      expect(onSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ keepOpenWhenUnfocused: true }),
      ),
    )
  })

  it('keeps kill all in the bottom action area on the main view', () => {
    renderPanel([baseEntry])

    const footer = screen.getByRole('button', { name: 'Kill All Watched' }).closest('footer')
    expect(footer).toBeTruthy()
  })

  it('parses settings range input', () => {
    expect(parseRanges('3000-3002, 5173')).toEqual([
      { start: 3000, end: 3002 },
      { start: 5173, end: 5173 },
    ])
  })

  it('parses excluded process names', () => {
    expect(parseProcessNames('Google Chrome, Hammerspoon, Google Chrome')).toEqual(['Google Chrome', 'Hammerspoon'])
  })

  it('uses a project name for node commands', () => {
    expect(
      getEntryDisplayName({
        ...baseEntry,
        command: 'node /Users/josephcampuzano/me/portless/node_modules/.bin/vite --port 5173',
      }),
    ).toBe('Portless')
  })

  it('uses mac app bundle names when available', () => {
    expect(
      getEntryDisplayName({
        ...baseEntry,
        processName: 'Google Chrome',
        command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9222',
      }),
    ).toBe('Google Chrome')
  })
})
