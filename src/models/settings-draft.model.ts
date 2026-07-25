import { effect, signal, type ReadonlySignal } from "@preact/signals";
import type { AppSettings, PortRange } from "../lib/types";
import {
  formatProcessNames,
  formatRanges,
  parseProcessNames,
  parseRanges,
} from "../lib/utils";
import type { PortsyNotifications } from "./notifications.model";

type BusyKey = string | null;

export interface PortsySettingsDraft {
  busyKey: ReadonlySignal<BusyKey>;
  draftRanges: ReadonlySignal<string>;
  draftExcludedProcessNames: ReadonlySignal<string>;
  launchAtLogin: ReadonlySignal<boolean>;
  keepOpenWhenUnfocused: ReadonlySignal<boolean>;
  setDraftRanges: (value: string) => void;
  setDraftExcludedProcessNames: (value: string) => void;
  saveRangesOnBlur: () => void;
  saveExcludedProcessNamesOnBlur: () => void;
  saveLaunchAtLoginOnChange: (value: boolean) => void;
  saveKeepOpenWhenUnfocusedOnChange: (value: boolean) => void;
}

function sameRanges(left: PortRange[], right: PortRange[]) {
  return (
    left.length === right.length &&
    left.every((range, index) => {
      const other = right[index];
      return range.start === other?.start && range.end === other.end;
    })
  );
}

function sameStrings(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function createSettingsDraftModel(
  settings: ReadonlySignal<AppSettings>,
  saveSettings: (settings: AppSettings) => Promise<AppSettings>,
  notifications: PortsyNotifications,
): PortsySettingsDraft {
  const busyKey = signal<BusyKey>(null);
  const draftRanges = signal(formatRanges(settings.value.ranges));
  const draftExcludedProcessNames = signal(
    formatProcessNames(settings.value.excludedProcessNames),
  );
  const launchAtLogin = signal(settings.value.launchAtLogin);
  const keepOpenWhenUnfocused = signal(settings.value.keepOpenWhenUnfocused);
  let settingsRevision = settings.value.lastUpdatedAt;

  const resetSettingsDraft = (nextSettings: AppSettings) => {
    draftRanges.value = formatRanges(nextSettings.ranges);
    draftExcludedProcessNames.value = formatProcessNames(nextSettings.excludedProcessNames);
    launchAtLogin.value = nextSettings.launchAtLogin;
    keepOpenWhenUnfocused.value = nextSettings.keepOpenWhenUnfocused;
  };

  effect(() => {
    const nextSettings = settings.value;
    if (nextSettings.lastUpdatedAt === settingsRevision) return;

    settingsRevision = nextSettings.lastUpdatedAt;
    resetSettingsDraft(nextSettings);
  });

  const saveSettingsField = async (key: string, nextSettings: AppSettings) => {
    busyKey.value = key;
    try {
      return await saveSettings(nextSettings);
    } catch (error) {
      notifications.error(error);
      throw error;
    } finally {
      busyKey.value = null;
    }
  };

  return {
    busyKey,
    draftRanges,
    draftExcludedProcessNames,
    launchAtLogin,
    keepOpenWhenUnfocused,
    setDraftRanges: (value) => {
      draftRanges.value = value;
    },
    setDraftExcludedProcessNames: (value) => {
      draftExcludedProcessNames.value = value;
    },
    saveRangesOnBlur: () => {
      let ranges: PortRange[];
      try {
        ranges = parseRanges(draftRanges.value);
      } catch (error) {
        notifications.error(error);
        return;
      }

      if (sameRanges(ranges, settings.value.ranges)) {
        draftRanges.value = formatRanges(settings.value.ranges);
        return;
      }

      void saveSettingsField("ranges", {
        ...settings.value,
        ranges,
        launchAtLogin: launchAtLogin.value,
        keepOpenWhenUnfocused: keepOpenWhenUnfocused.value,
      }).catch(() => undefined);
    },
    saveExcludedProcessNamesOnBlur: () => {
      const excludedProcessNames = parseProcessNames(draftExcludedProcessNames.value);

      if (sameStrings(excludedProcessNames, settings.value.excludedProcessNames)) {
        draftExcludedProcessNames.value = formatProcessNames(settings.value.excludedProcessNames);
        return;
      }

      void saveSettingsField("excludedProcessNames", {
        ...settings.value,
        excludedProcessNames,
        launchAtLogin: launchAtLogin.value,
        keepOpenWhenUnfocused: keepOpenWhenUnfocused.value,
      }).catch(() => undefined);
    },
    saveLaunchAtLoginOnChange: (nextLaunchAtLogin) => {
      const previousLaunchAtLogin = launchAtLogin.value;
      launchAtLogin.value = nextLaunchAtLogin;

      void saveSettingsField("launchAtLogin", {
        ...settings.value,
        launchAtLogin: nextLaunchAtLogin,
        keepOpenWhenUnfocused: keepOpenWhenUnfocused.value,
      }).catch(() => {
        launchAtLogin.value = previousLaunchAtLogin;
      });
    },
    saveKeepOpenWhenUnfocusedOnChange: (nextKeepOpenWhenUnfocused) => {
      const previousKeepOpenWhenUnfocused = keepOpenWhenUnfocused.value;
      keepOpenWhenUnfocused.value = nextKeepOpenWhenUnfocused;

      void saveSettingsField("keepOpenWhenUnfocused", {
        ...settings.value,
        launchAtLogin: launchAtLogin.value,
        keepOpenWhenUnfocused: nextKeepOpenWhenUnfocused,
      }).catch(() => {
        keepOpenWhenUnfocused.value = previousKeepOpenWhenUnfocused;
      });
    },
  };
}
