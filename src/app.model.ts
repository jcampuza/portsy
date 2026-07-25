import {
  getSettings,
  getSnapshot,
  onSnapshot,
  saveSettings,
  startMonitor,
} from "./lib/tauri";
import { defaultSettings, type AppSettings, type PortSnapshot } from "./lib/types";
import { createAsyncListenerCleanup } from "./lib/utils";
import { createModel, effect, signal, type Model, type ReadonlySignal } from "@preact/signals";
import { Result } from "better-result";
import {
  createNotifications,
  errorMessage,
  type PortsyNotifications,
} from "./models/notifications.model";
import { createPortsModel, type PortsyPorts } from "./models/ports.model";
import {
  createSettingsDraftModel,
  type PortsySettingsDraft,
} from "./models/settings-draft.model";

export type { PortsyNotice } from "./models/notifications.model";

export interface Portsy {
  settings: ReadonlySignal<AppSettings>;
  snapshot: ReadonlySignal<PortSnapshot | null>;
  loading: ReadonlySignal<boolean>;
  notifications: PortsyNotifications;
  ports: PortsyPorts;
  settingsDraft: PortsySettingsDraft;
  start: () => Promise<void>;
  stop: () => void;
  saveSettings: (nextSettings: AppSettings) => Promise<AppSettings>;
}

export type PortsyModel = Model<Portsy>;

export const PortsyModel = createModel<Portsy>(() => {
  const settings = signal(defaultSettings);
  const snapshot = signal<PortSnapshot | null>(null);
  const loading = signal(true);
  const running = signal(false);
  const notifications = createNotifications();

  const refresh = async () => {
    const result = await Result.tryPromise({
      try: getSnapshot,
      catch: errorMessage,
    });

    result.match({
      ok: (next) => {
        snapshot.value = next;
      },
      err: (error) => {
        notifications.error(error);
      },
    });

    loading.value = false;
  };

  const saveAppSettings = async (nextSettings: AppSettings) => {
    const saved = await saveSettings(nextSettings);
    settings.value = saved;
    await refresh();
    return saved;
  };

  effect(() => {
    if (!running.value) return;

    return createAsyncListenerCleanup(
      onSnapshot,
      (next) => {
        snapshot.value = next;
      },
      (error) => {
        notifications.error(error);
      },
    );
  });

  const ports = createPortsModel({
    settings,
    snapshot,
    notifications,
    refresh,
    saveSettings: saveAppSettings,
  });
  const settingsDraft = createSettingsDraftModel(settings, saveAppSettings, notifications);

  let startup: Promise<void> | null = null;

  const start = async () => {
    if (startup) return startup;

    running.value = true;
    loading.value = true;

    startup = (async () => {
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
          notifications.error(error);
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
            notifications.error(error);
          },
        });
      }

      loading.value = false;
    })();

    return startup;
  };

  return {
    settings,
    snapshot,
    loading,
    notifications,
    ports,
    settingsDraft,
    start,
    stop: () => {
      running.value = false;
      startup = null;
    },
    saveSettings: saveAppSettings,
  };
});
