import { useEffect, useState } from 'preact/hooks'
import { PortsyPanel } from './components/PortsyPanel'
import {
  getSettings,
  getSnapshot,
  killAllWatched,
  killPort,
  onOpened,
  onSnapshot,
  saveSettings,
  startMonitor,
} from './lib/tauri'
import { defaultSettings, type AppSettings, type PortEntry, type PortSnapshot } from './lib/types'
import './app.css'

export function App() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [snapshot, setSnapshot] = useState<PortSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    try {
      const next = await getSnapshot()
      setSnapshot(next)
      setMessage(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let disposed = false
    const unlisteners: Array<() => void> = []

    async function boot() {
      try {
        const [loadedSettings, loadedSnapshot, unlistenSnapshot, unlistenOpened] = await Promise.all([
          getSettings(),
          getSnapshot(),
          onSnapshot((next) => {
            if (!disposed) setSnapshot(next)
          }),
          onOpened(() => {
            void refresh()
          }),
        ])
        if (disposed) return
        setSettings(loadedSettings)
        setSnapshot(loadedSnapshot)
        unlisteners.push(unlistenSnapshot, unlistenOpened)
        await startMonitor()
      } catch (error) {
        if (!disposed) setMessage(error instanceof Error ? error.message : String(error))
      } finally {
        if (!disposed) setLoading(false)
      }
    }

    void boot()
    return () => {
      disposed = true
      unlisteners.forEach((unlisten) => unlisten())
    }
  }, [])

  return (
    <PortsyPanel
      snapshot={snapshot}
      settings={settings}
      loading={loading}
      message={message}
      onRefresh={refresh}
      onKillPort={(entry: PortEntry) => killPort(entry.pid, entry.port)}
      onKillAll={killAllWatched}
      onSaveSettings={async (nextSettings) => {
        const saved = await saveSettings(nextSettings)
        setSettings(saved)
        await refresh()
        return saved
      }}
    />
  )
}

