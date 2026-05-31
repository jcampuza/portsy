export interface PortRange {
  start: number
  end: number
}

export interface AppSettings {
  lastUpdatedAt: number
  ranges: PortRange[]
  refreshIntervalMs: number
  launchAtLogin: boolean
  keepOpenWhenUnfocused: boolean
  excludedProcessNames: string[]
}

export interface PortEntry {
  protocol: string
  port: number
  pid: number
  processName: string
  command: string
  user: string
  bindAddresses: string[]
  killDisabledReason: string | null
}

export interface PortSnapshot {
  scannedAtMs: number
  ranges: PortRange[]
  entries: PortEntry[]
}

export interface KillReport {
  port: number
  pid: number
  processName: string
  terminated: boolean
  forced: boolean
  message: string
}

export interface KillOutcome {
  ok: boolean
  report: KillReport | null
  error: string | null
}

export const defaultSettings: AppSettings = {
  lastUpdatedAt: 0,
  ranges: [{ start: 3000, end: 9999 }],
  refreshIntervalMs: 2000,
  launchAtLogin: false,
  keepOpenWhenUnfocused: false,
  excludedProcessNames: [],
}
