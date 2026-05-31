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
import { Result } from "better-result";
import { createAsyncListenerCleanup, iife } from "./lib/utils";

export interface Portsy {
  settings: ReadonlySignal<AppSettings>;
  snapshot: ReadonlySignal<PortSnapshot | null>;
  loading: ReadonlySignal<boolean>;
  message: ReadonlySignal<string | null>;
  clearMessage: () => void;
  refresh: () => Promise<void>;
  killPort: (entry: PortEntry) => Promise<KillReport>;
  killAllWatched: (snapshot: PortSnapshot) => Promise<KillOutcome[]>;
  openPort: (entry: PortEntry) => Promise<string>;
  saveSettings: (nextSettings: AppSettings) => Promise<AppSettings>;
}

export type PortsyModel = Model<Portsy>;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const PortsyModel = createModel<Portsy>(() => {
  const settings = signal(defaultSettings);
  const snapshot = signal<PortSnapshot | null>(null);
  const loading = signal(true);
  const message = signal<string | null>(null);

  const refresh = async () => {
    const result = await Result.tryPromise({
      try: getSnapshot,
      catch: errorMessage,
    });

    result.match({
      ok: (next) => {
        snapshot.value = next;
        message.value = null;
      },
      err: (error) => {
        message.value = error;
      },
    });

    loading.value = false;
  };

  const cleanupSnapshotListener = createAsyncListenerCleanup(
    onSnapshot,
    (next) => {
      snapshot.value = next;
    },
    (error) => {
      message.value = errorMessage(error);
    },
  );

  effect(() => cleanupSnapshotListener);

  iife(async () => {
    const initialState = await Result.tryPromise({
      try: () => Promise.all([getSettings(), getSnapshot()]),
      catch: errorMessage,
    });

    const shouldStartMonitor = initialState.match({
      ok: ([loadedSettings, loadedSnapshot]) => {
        settings.value = loadedSettings;
        snapshot.value = loadedSnapshot;
        return true;
      },
      err: (error) => {
        message.value = error;
        return false;
      },
    });

    if (shouldStartMonitor) {
      const monitor = await Result.tryPromise({
        try: startMonitor,
        catch: errorMessage,
      });

      monitor.match({
        ok: () => undefined,
        err: (error) => {
          message.value = error;
        },
      });
    }

    loading.value = false;
  });

  return {
    settings,
    snapshot,
    loading,
    message,

    clearMessage: () => {
      message.value = null;
    },

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
