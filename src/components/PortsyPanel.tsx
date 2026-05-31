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

const shellClass = 'flex min-h-screen w-full flex-col gap-3 p-3.5'
const headerClass = 'flex items-start justify-between gap-3'
const titleClass = 'm-0 text-[22px] leading-[1.1] font-semibold'
const subtitleClass = 'mt-1 mb-0 text-[13px] text-muted'
const buttonBaseClass =
  'inline-flex min-h-8 items-center justify-center rounded-md border border-border bg-panel px-2.5 py-1.5 text-sm text-text transition-colors enabled:cursor-pointer enabled:hover:border-accent disabled:cursor-not-allowed disabled:opacity-50'
const primaryButtonClass = `${buttonBaseClass} border-accent bg-accent text-white enabled:hover:border-accent-strong enabled:hover:bg-accent-strong`
const dangerButtonClass = `${buttonBaseClass} border-danger/45 bg-danger-bg text-danger enabled:hover:border-danger`
const compactButtonClass = `${buttonBaseClass} min-w-[54px] shrink-0`
const compactDangerButtonClass = `${dangerButtonClass} min-w-[54px] shrink-0`
const panelClass = 'rounded-lg border border-border bg-panel'
const inputClass =
  'min-h-[34px] w-full rounded-md border border-border bg-panel px-2 py-1.5 text-text outline-none transition-colors placeholder:text-muted/75 focus:border-accent'
const textareaClass = `${inputClass} min-h-[74px] resize-y`
const labelClass = 'grid gap-1.5 text-xs text-muted'

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
      <main class={shellClass}>
        <header class="flex items-start justify-start gap-3">
          <button type="button" class={`${buttonBaseClass} shrink-0`} onClick={() => setView('main')}>
            Back
          </button>
          <div>
            <h1 class={titleClass}>Settings</h1>
            <p class={subtitleClass}>Configure watched ports and hidden processes</p>
          </div>
        </header>

        {activeMessage && (
          <div class={`${panelClass} px-2.5 py-2 text-[13px] text-success`} role="status">
            {activeMessage}
          </div>
        )}

        <section class={`${panelClass} flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto p-3`} aria-label="Settings">
          <label class={labelClass}>
            Port ranges
            <input
              class={inputClass}
              value={draftRanges}
              onInput={(event) => setDraftRanges(event.currentTarget.value)}
              placeholder="3000-9999, 5173"
            />
          </label>
          <label class="flex items-center gap-2 text-sm text-text">
            <input
              class="h-4 w-4 accent-accent"
              type="checkbox"
              checked={launchAtLogin}
              onChange={(event) => setLaunchAtLogin(event.currentTarget.checked)}
            />
            Launch at login
          </label>
          <label class={labelClass}>
            Excluded processes
            <textarea
              class={textareaClass}
              value={draftExcludedProcessNames}
              onInput={(event) => setDraftExcludedProcessNames(event.currentTarget.value)}
              placeholder="Google Chrome, Hammerspoon, Raycast"
            />
          </label>
        </section>

        <footer class="flex shrink-0 items-center gap-2">
          <button type="button" class={`${primaryButtonClass} w-full`} onClick={saveDraftSettings} disabled={busyKey === 'settings'}>
            Save Settings
          </button>
        </footer>
      </main>
    )
  }

  return (
    <main class={shellClass}>
      <header class={headerClass}>
        <div>
          <h1 class={titleClass}>Portsy</h1>
          <p class={subtitleClass}>{entries.length} watched TCP port{entries.length === 1 ? '' : 's'} in use</p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button type="button" class={`${buttonBaseClass} min-w-[72px]`} onClick={onRefresh} disabled={loading} title="Refresh ports">
            Refresh
          </button>
          <button type="button" class={`${buttonBaseClass} min-w-[72px]`} onClick={openSettings} title="Settings">
            Settings
          </button>
        </div>
      </header>

      {activeMessage && (
        <div class={`${panelClass} px-2.5 py-2 text-[13px] text-success`} role="status">
          {activeMessage}
        </div>
      )}

      {confirmKillAll && (
        <section class={`${panelClass} flex flex-col gap-2.5 p-3`} role="dialog" aria-label="Confirm kill all">
          <h2 class="m-0 text-base font-semibold">Confirm Kill All</h2>
          <p class="m-0 text-[13px] text-muted">
            {killableEntries.length} process{killableEntries.length === 1 ? '' : 'es'} will receive SIGTERM.
          </p>
          <ul class="m-0 max-h-[150px] list-none overflow-auto p-0">
            {killableEntries.map((entry) => (
              <li class="flex justify-between gap-2.5 border-b border-border py-1.5 text-[13px]" key={`${entry.pid}:${entry.port}`}>
                <strong>{entry.port}</strong> {getEntryDisplayName(entry)} <span>PID {entry.pid}</span>
              </li>
            ))}
          </ul>
          {disabledKillAll.length > 0 && (
            <p class="m-0 text-[13px] text-muted">
              {disabledKillAll.length} watched row{disabledKillAll.length === 1 ? '' : 's'} cannot be killed.
            </p>
          )}
          <div class="flex items-center justify-end gap-2">
            <button type="button" class={buttonBaseClass} onClick={() => setConfirmKillAll(false)}>
              Cancel
            </button>
            <button type="button" class={dangerButtonClass} onClick={killAllConfirmed} disabled={busyKey === 'kill-all'}>
              Confirm
            </button>
          </div>
        </section>
      )}

      <section class="flex min-h-0 flex-1 flex-col gap-2 overflow-auto" aria-label="Watched ports">
        {loading && entries.length === 0 && (
          <div class={`${panelClass} px-4 py-7 text-center text-muted`}>Scanning watched ports...</div>
        )}
        {!loading && entries.length === 0 && (
          <div class={`${panelClass} px-4 py-7 text-center text-muted`}>No watched TCP listeners found.</div>
        )}
        {entries.map((entry) => {
          const key = `${entry.pid}:${entry.port}`
          const displayName = getEntryDisplayName(entry)
          return (
            <article class={`${panelClass} flex items-start justify-between gap-2.5 p-2.5`} key={key}>
              <div class="flex min-w-0 gap-2.5">
                <div class="shrink-0 basis-[58px] rounded-md bg-accent px-1 py-[7px] text-center font-mono text-[15px] leading-none font-bold text-white">
                  {entry.port}
                </div>
                <div class="min-w-0">
                  <div class="flex flex-wrap items-baseline gap-1.5 text-sm leading-tight">
                    <strong title={entry.command}>{displayName}</strong>
                    <span class="text-xs text-muted">PID {entry.pid}</span>
                  </div>
                  <div class="mt-[3px] max-w-60 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-text" title={entry.command}>
                    {entry.processName}
                  </div>
                  <div class="mt-[3px] text-xs text-muted">{entry.bindAddresses.join(', ')} | {entry.user}</div>
                  {entry.killDisabledReason && <div class="mt-1 text-xs text-warning">{entry.killDisabledReason}</div>}
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  class={compactButtonClass}
                  disabled={busyKey === `exclude:${entry.pid}:${entry.port}`}
                  onClick={() => excludeProcess(entry)}
                >
                  Hide
                </button>
                <button
                  type="button"
                  class={compactDangerButtonClass}
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

      <footer class="bottom-actions flex shrink-0 items-center gap-2">
        <button
          type="button"
          class={`${dangerButtonClass} w-full`}
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
