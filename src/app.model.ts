import {
  getSettings,
  getSnapshot,
  killAllWatched,
  killPort,
  openPort,
  onSnapshot,
  saveSettings,
  startMonitor,
} from "./lib/tauri";
import {
  defaultSettings,
  type AppSettings,
  type KillOutcome,
  type KillReport,
  type PortEntry,
  type PortSnapshot,
} from "./lib/types";
import { createModel, effect, signal, type Model, type ReadonlySignal } from "@preact/signals";

export interface Portsy {
  settings: ReadonlySignal<AppSettings>;
  snapshot: ReadonlySignal<PortSnapshot | null>;
  loading: ReadonlySignal<boolean>;
  message: ReadonlySignal<string | null>;
  refresh: () => Promise<void>;
  killPort: (entry: PortEntry) => Promise<KillReport>;
  killAllWatched: (snapshot: PortSnapshot) => Promise<KillOutcome[]>;
  openPort: (entry: PortEntry) => Promise<string>;
  saveSettings: (nextSettings: AppSettings) => Promise<AppSettings>;
}

export type PortsyModel = Model<Portsy>;

export const PortsyModel = createModel<Portsy>(() => {
  const settings = signal(defaultSettings);
  const snapshot = signal<PortSnapshot | null>(null);
  const loading = signal(true);
  const message = signal<string | null>(null);

  const refresh = async () => {
    try {
      const next = await getSnapshot();
      snapshot.value = next;
    } catch (error) {
      message.value = error instanceof Error ? error.message : String(error);
    } finally {
      loading.value = false;
    }
  };

  const unlistenSnapshot = onSnapshot((next) => {
    snapshot.value = next;
  });

  effect(() => {
    (async () => {
      const [loadedSettings, loadedSnapshot] = await Promise.all([getSettings(), getSnapshot()]);
      settings.value = loadedSettings;
      snapshot.value = loadedSnapshot;

      await startMonitor();
    })();

    return () => {
      Promise.resolve(unlistenSnapshot).then((unlisten) => unlisten());
    };
  });

  return {
    settings,
    snapshot,
    loading,
    message,

    refresh: refresh,

    killPort: async (entry: PortEntry) => {
      const report = await killPort(entry.pid, entry.port);
      return report;
    },

    killAllWatched: async (snapshot: PortSnapshot) => {
      const outcomes = await killAllWatched(snapshot);
      return outcomes;
    },

    openPort: async (entry: PortEntry) => {
      return openPort(entry.port);
    },

    saveSettings: async (nextSettings: AppSettings) => {
      const saved = await saveSettings(nextSettings);
      settings.value = saved;
      await refresh();
      return saved;
    },
  };
});
