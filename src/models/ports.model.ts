import { computed, signal, type ReadonlySignal } from "@preact/signals";
import { killAllWatched, killPort, openPort } from "../lib/tauri";
import type { AppSettings, PortEntry, PortSnapshot } from "../lib/types";
import { groupEntriesByPid } from "../lib/utils";
import type { PortsyNotifications } from "./notifications.model";

type BusyKey = string | null;

export interface PortsyPorts {
  entries: ReadonlySignal<PortEntry[]>;
  killableEntries: ReadonlySignal<PortEntry[]>;
  nonKillableEntries: ReadonlySignal<PortEntry[]>;
  busyKey: ReadonlySignal<BusyKey>;
  killAllConfirmationVisible: ReadonlySignal<boolean>;
  refresh: () => Promise<void>;
  showKillAll: () => void;
  cancelKillAll: () => void;
  confirmKillAll: () => Promise<void>;
  killEntry: (entry: PortEntry) => Promise<void>;
  openEntry: (entry: PortEntry) => Promise<void>;
  excludeProcess: (entry: PortEntry) => Promise<void>;
}

interface CreatePortsModelOptions {
  settings: ReadonlySignal<AppSettings>;
  snapshot: ReadonlySignal<PortSnapshot | null>;
  notifications: PortsyNotifications;
  refresh: () => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<AppSettings>;
}

export function createPortsModel({
  settings,
  snapshot,
  notifications,
  refresh,
  saveSettings,
}: CreatePortsModelOptions): PortsyPorts {
  const entries = computed(() => snapshot.value?.entries ?? []);
  const processes = computed(() => groupEntriesByPid(entries.value).map((group) => group[0]));
  const killableEntries = computed(() => processes.value.filter((entry) => !entry.killDisabledReason));
  const nonKillableEntries = computed(() => processes.value.filter((entry) => entry.killDisabledReason));
  const busyKey = signal<BusyKey>(null);
  const killAllConfirmationVisible = signal(false);

  return {
    entries,
    killableEntries,
    nonKillableEntries,
    busyKey,
    killAllConfirmationVisible,
    refresh,
    showKillAll: () => {
      killAllConfirmationVisible.value = true;
    },
    cancelKillAll: () => {
      killAllConfirmationVisible.value = false;
    },
    confirmKillAll: async () => {
      const currentSnapshot = snapshot.value;
      if (!currentSnapshot) return;

      busyKey.value = "kill-all";
      try {
        const outcomes = await killAllWatched(currentSnapshot);
        const failed = outcomes.filter((outcome) => !outcome.ok);
        const killed = outcomes.filter((outcome) => outcome.ok).length;

        if (failed.length === 0) {
          notifications.success(
            `Killed ${killed} watched process${killed === 1 ? "" : "es"}.`,
          );
        } else {
          notifications.error(`Killed ${killed}; ${failed.length} failed.`);
        }

        killAllConfirmationVisible.value = false;
        await refresh();
      } catch (error) {
        notifications.error(error);
      } finally {
        busyKey.value = null;
      }
    },
    killEntry: async (entry) => {
      const key = `${entry.pid}:${entry.port}`;
      busyKey.value = key;
      try {
        const report = await killPort(entry.pid, entry.port);
        notifications.success(report.message);
        await refresh();
      } catch (error) {
        notifications.error(error);
      } finally {
        busyKey.value = null;
      }
    },
    openEntry: async (entry) => {
      const key = `open:${entry.pid}:${entry.port}`;
      busyKey.value = key;
      try {
        await openPort(entry.port);
      } catch (error) {
        notifications.error(error);
      } finally {
        busyKey.value = null;
      }
    },
    excludeProcess: async (entry) => {
      const processName = entry.processName.trim();
      if (!processName) return;

      const currentSettings = settings.value;
      const existingNames = new Set(
        currentSettings.excludedProcessNames.map((name) => name.toLowerCase()),
      );
      const excludedProcessNames = existingNames.has(processName.toLowerCase())
        ? currentSettings.excludedProcessNames
        : [...currentSettings.excludedProcessNames, processName].sort((left, right) =>
            left.localeCompare(right),
          );

      busyKey.value = `exclude:${entry.pid}:${entry.port}`;
      try {
        await saveSettings({
          ...currentSettings,
          excludedProcessNames,
        });
        notifications.success(`Excluded ${processName}.`);
      } catch (error) {
        notifications.error(error);
      } finally {
        busyKey.value = null;
      }
    },
  };
}
