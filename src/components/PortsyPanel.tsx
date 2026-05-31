import { useState } from 'preact/hooks'
import type { AppSettings, KillOutcome, KillReport, PortEntry, PortRange, PortSnapshot } from '../lib/types'

interface PortsyPanelProps {
  snapshot: PortSnapshot | null
  settings: AppSettings
  loading: boolean
  message: string | null
  onRefresh: () => void
  onKillPort: (entry: PortEntry) => Promise<KillReport>
  onKillAll: (snapshot: PortSnapshot) => Promise<KillOutcome[]>
  onSaveSettings: (settings: AppSettings) => Promise<AppSettings>
}

type View = 'main' | 'settings'

export function PortsyPanel({
  snapshot,
  settings,
  loading,
  message,
  onRefresh,
  onKillPort,
  onKillAll,
  onSaveSettings,
}: PortsyPanelProps) {
  const [view, setView] = useState<View>('main')
  const [confirmKillAll, setConfirmKillAll] = useState(false)
  const [draftRanges, setDraftRanges] = useState(formatRanges(settings.ranges))
  const [draftExcludedProcessNames, setDraftExcludedProcessNames] = useState(formatProcessNames(settings.excludedProcessNames))
  const [launchAtLogin, setLaunchAtLogin] = useState(settings.launchAtLogin)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [localMessage, setLocalMessage] = useState<string | null>(null)

  const entries = snapshot?.entries ?? []
  const activeMessage = localMessage ?? message
  const disabledKillAll = entries.filter((entry) => entry.killDisabledReason)
  const killableEntries = entries.filter((entry) => !entry.killDisabledReason)

  function openSettings() {
    setDraftRanges(formatRanges(settings.ranges))
    setDraftExcludedProcessNames(formatProcessNames(settings.excludedProcessNames))
    setLaunchAtLogin(settings.launchAtLogin)
    setConfirmKillAll(false)
    setView('settings')
  }

  async function saveDraftSettings() {
    const ranges = parseRanges(draftRanges)
    setBusyKey('settings')
    try {
      const saved = await onSaveSettings({
        ...settings,
        ranges,
        excludedProcessNames: parseProcessNames(draftExcludedProcessNames),
        launchAtLogin,
      })
      setDraftRanges(formatRanges(saved.ranges))
      setDraftExcludedProcessNames(formatProcessNames(saved.excludedProcessNames))
      setLocalMessage('Settings saved.')
      setView('main')
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyKey(null)
    }
  }

  async function excludeProcess(entry: PortEntry) {
    const processName = entry.processName.trim()
    if (!processName) return
    const existingNames = new Set(settings.excludedProcessNames.map((name) => name.toLowerCase()))
    const excludedProcessNames = existingNames.has(processName.toLowerCase())
      ? settings.excludedProcessNames
      : [...settings.excludedProcessNames, processName].sort((left, right) => left.localeCompare(right))

    setBusyKey(`exclude:${entry.pid}:${entry.port}`)
    try {
      const saved = await onSaveSettings({
        ...settings,
        excludedProcessNames,
      })
      setDraftExcludedProcessNames(formatProcessNames(saved.excludedProcessNames))
      setLocalMessage(`Excluded ${processName}.`)
      onRefresh()
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyKey(null)
    }
  }

  async function killEntry(entry: PortEntry) {
    const key = `${entry.pid}:${entry.port}`
    setBusyKey(key)
    try {
      const report = await onKillPort(entry)
      setLocalMessage(report.message)
      onRefresh()
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyKey(null)
    }
  }

  async function killAllConfirmed() {
    if (!snapshot) return
    setBusyKey('kill-all')
    try {
      const outcomes = await onKillAll(snapshot)
      const failed = outcomes.filter((outcome) => !outcome.ok)
      const killed = outcomes.filter((outcome) => outcome.ok).length
      setLocalMessage(
        failed.length === 0
          ? `Killed ${killed} watched process${killed === 1 ? '' : 'es'}.`
          : `Killed ${killed}; ${failed.length} failed.`,
      )
      setConfirmKillAll(false)
      onRefresh()
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyKey(null)
    }
  }

  if (view === 'settings') {
    return (
      <main class="app-shell settings-view">
        <header class="settings-header">
          <button type="button" class="back-button" onClick={() => setView('main')}>
            Back
          </button>
          <div>
            <h1>Settings</h1>
            <p>Configure watched ports and hidden processes</p>
          </div>
        </header>

        {activeMessage && <div class="message" role="status">{activeMessage}</div>}

        <section class="settings-panel" aria-label="Settings">
          <label>
            Port ranges
            <input
              value={draftRanges}
              onInput={(event) => setDraftRanges(event.currentTarget.value)}
              placeholder="3000-9999, 5173"
            />
          </label>
          <label class="check-row">
            <input
              type="checkbox"
              checked={launchAtLogin}
              onChange={(event) => setLaunchAtLogin(event.currentTarget.checked)}
            />
            Launch at login
          </label>
          <label>
            Excluded processes
            <textarea
              value={draftExcludedProcessNames}
              onInput={(event) => setDraftExcludedProcessNames(event.currentTarget.value)}
              placeholder="Google Chrome, Hammerspoon, Raycast"
            />
          </label>
        </section>

        <footer class="bottom-actions">
          <button type="button" class="primary full-width" onClick={saveDraftSettings} disabled={busyKey === 'settings'}>
            Save Settings
          </button>
        </footer>
      </main>
    )
  }

  return (
    <main class="app-shell">
      <header class="topbar">
        <div>
          <h1>Portsy</h1>
          <p>{entries.length} watched TCP port{entries.length === 1 ? '' : 's'} in use</p>
        </div>
        <div class="toolbar">
          <button type="button" class="icon-button" onClick={onRefresh} disabled={loading} title="Refresh ports">
            Refresh
          </button>
          <button type="button" class="icon-button" onClick={openSettings} title="Settings">
            Settings
          </button>
        </div>
      </header>

      {activeMessage && <div class="message" role="status">{activeMessage}</div>}

      {confirmKillAll && (
        <section class="confirm-panel" role="dialog" aria-label="Confirm kill all">
          <h2>Confirm Kill All</h2>
          <p>{killableEntries.length} process{killableEntries.length === 1 ? '' : 'es'} will receive SIGTERM.</p>
          <ul>
            {killableEntries.map((entry) => (
              <li key={`${entry.pid}:${entry.port}`}>
                <strong>{entry.port}</strong> {getEntryDisplayName(entry)} <span>PID {entry.pid}</span>
              </li>
            ))}
          </ul>
          {disabledKillAll.length > 0 && (
            <p class="muted">{disabledKillAll.length} watched row{disabledKillAll.length === 1 ? '' : 's'} cannot be killed.</p>
          )}
          <div class="settings-actions">
            <button type="button" onClick={() => setConfirmKillAll(false)}>Cancel</button>
            <button type="button" class="danger" onClick={killAllConfirmed} disabled={busyKey === 'kill-all'}>
              Confirm
            </button>
          </div>
        </section>
      )}

      <section class="port-list" aria-label="Watched ports">
        {loading && entries.length === 0 && <div class="empty-state">Scanning watched ports...</div>}
        {!loading && entries.length === 0 && <div class="empty-state">No watched TCP listeners found.</div>}
        {entries.map((entry) => {
          const key = `${entry.pid}:${entry.port}`
          const displayName = getEntryDisplayName(entry)
          return (
            <article class="port-row" key={key}>
              <div class="port-main">
                <div class="port-number">{entry.port}</div>
                <div class="process-block">
                  <div class="process-line">
                    <strong title={entry.command}>{displayName}</strong>
                    <span>PID {entry.pid}</span>
                  </div>
                  <div class="command-line" title={entry.command}>{entry.processName}</div>
                  <div class="bind-line">{entry.bindAddresses.join(', ')} | {entry.user}</div>
                  {entry.killDisabledReason && <div class="disabled-reason">{entry.killDisabledReason}</div>}
                </div>
              </div>
              <div class="row-actions">
                <button
                  type="button"
                  class="compact"
                  disabled={busyKey === `exclude:${entry.pid}:${entry.port}`}
                  onClick={() => excludeProcess(entry)}
                >
                  Hide
                </button>
                <button
                  type="button"
                  class="danger compact"
                  disabled={Boolean(entry.killDisabledReason) || busyKey === key}
                  onClick={() => killEntry(entry)}
                >
                  Kill
                </button>
              </div>
            </article>
          )
        })}
      </section>

      <footer class="bottom-actions">
        <button
          type="button"
          class="danger full-width"
          disabled={killableEntries.length === 0 || busyKey === 'kill-all'}
          onClick={() => setConfirmKillAll(true)}
        >
          Kill All Watched
        </button>
      </footer>
    </main>
  )
}

export function formatProcessNames(names: string[]) {
  return names.join(', ')
}

export function parseProcessNames(value: string) {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))
}

export function getEntryDisplayName(entry: PortEntry) {
  const commandName = displayNameFromCommand(entry.command, entry.processName)
  return commandName || entry.processName
}

function displayNameFromCommand(command: string, processName: string) {
  const appName = appNameFromPath(command)
  if (appName) return appName

  const tokens = tokenizeCommand(command)
  for (const token of tokens) {
    const tokenAppName = appNameFromPath(token)
    if (tokenAppName) return tokenAppName
  }

  for (const token of tokens) {
    if (!token.startsWith('/') && !token.startsWith('~/')) continue
    const name = nameFromProjectPath(token, processName)
    if (name) return name
  }

  return null
}

function tokenizeCommand(command: string) {
  return command.match(/"[^"]+"|'[^']+'|\S+/g)?.map((token) => token.replace(/^["']|["']$/g, '')) ?? []
}

function appNameFromPath(path: string) {
  const match = path.match(/\/([^/]+)\.app(?:\/|$)/)
  return match ? match[1] : null
}

function nameFromProjectPath(path: string, processName: string) {
  const parts = path.split('/').filter(Boolean)
  const nodeModulesIndex = parts.indexOf('node_modules')
  if (nodeModulesIndex > 0) {
    return humanizePathSegment(parts[nodeModulesIndex - 1])
  }

  const last = parts.at(-1)
  if (!last || last === processName || last.includes('.')) {
    const parent = parts.at(-2)
    return parent ? humanizePathSegment(parent) : null
  }
  return humanizePathSegment(last)
}

function humanizePathSegment(segment: string) {
  return segment
    .replace(/\.[^.]+$/, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function formatRanges(ranges: PortRange[]) {
  return ranges
    .map((range) => (range.start === range.end ? String(range.start) : `${range.start}-${range.end}`))
    .join(', ')
}

export function parseRanges(value: string): PortRange[] {
  const ranges = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map((item) => Number(item.trim()))
        return validateRange(start, end)
      }
      const port = Number(part)
      return validateRange(port, port)
    })

  if (ranges.length === 0) {
    throw new Error('Add at least one watched port range.')
  }
  return ranges
}

function validateRange(start: number, end: number): PortRange {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 65535 || start > end) {
    throw new Error('Port ranges must be between 1 and 65535.')
  }
  return { start, end }
}
