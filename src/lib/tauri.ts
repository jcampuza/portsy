import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { AppSettings, KillOutcome, KillReport, PortSnapshot } from './types'

export const snapshotEvent = 'portsy-snapshot'

export function getSnapshot() {
  return invoke<PortSnapshot>('get_snapshot')
}

export function startMonitor() {
  return invoke<void>('start_monitor')
}

export function getSettings() {
  return invoke<AppSettings>('get_settings')
}

export function saveSettings(settings: AppSettings) {
  return invoke<AppSettings>('save_settings', { settings })
}

export function killPort(pid: number, port: number) {
  return invoke<KillReport>('kill_port', { pid, port })
}

export function killAllWatched(snapshot: PortSnapshot) {
  return invoke<KillOutcome[]>('kill_all_watched', { snapshot })
}

export function openPort(port: number) {
  return invoke<string>('open_port', { port })
}

export function onSnapshot(callback: (snapshot: PortSnapshot) => void) {
  return listen<PortSnapshot>(snapshotEvent, (event) => callback(event.payload))
}
