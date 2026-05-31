import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { useApp } from "../app.provider";
import { PortsySettingsView } from "../components/PortsySettingsView";
import type { AppSettings } from "../lib/types";
import { formatProcessNames, formatRanges, parseProcessNames, parseRanges } from "../lib/utils";

export const SettingsRoute = () => {
  const app = useApp();
  const location = useLocation();

  return (
    <SettingsRouteView
      settings={app.settings.value}
      message={app.message.value}
      onBack={() => location.route("/")}
      onSaveSettings={(nextSettings) => {
        return app.saveSettings(nextSettings);
      }}
    />
  );
};

interface SettingsRouteViewProps {
  settings: AppSettings;
  message: string | null;
  onBack: () => void;
  onSaveSettings: (settings: AppSettings) => Promise<AppSettings>;
}

export function SettingsRouteView({
  settings,
  message,
  onBack,
  onSaveSettings,
}: SettingsRouteViewProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!toastMessage) return;

    const timeout = window.setTimeout(() => setToastMessage(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  async function saveSettings(key: string, nextSettings: AppSettings) {
    setBusyKey(key);
    try {
      const saved = await onSaveSettings(nextSettings);
      setLocalError(null);
      setToastMessage("Settings saved.");
      return saved;
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <SettingsDraftView
      key={settings.lastUpdatedAt}
      activeMessage={localError ?? message}
      busyKey={busyKey}
      settings={settings}
      toastMessage={toastMessage}
      onBack={onBack}
      onClearToast={() => setToastMessage(null)}
      onDismissMessage={() => setLocalError(null)}
      onError={(nextError) => setLocalError(nextError)}
      onSaveSettings={saveSettings}
    />
  );
}

interface SettingsDraftViewProps {
  activeMessage: string | null;
  busyKey: string | null;
  settings: AppSettings;
  toastMessage: string | null;
  onBack: () => void;
  onClearToast: () => void;
  onDismissMessage: () => void;
  onError: (message: string) => void;
  onSaveSettings: (key: string, settings: AppSettings) => Promise<AppSettings>;
}

function SettingsDraftView({
  activeMessage,
  busyKey,
  settings,
  toastMessage,
  onBack,
  onClearToast,
  onDismissMessage,
  onError,
  onSaveSettings,
}: SettingsDraftViewProps) {
  const [draftRanges, setDraftRanges] = useState(formatRanges(settings.ranges));
  const [draftExcludedProcessNames, setDraftExcludedProcessNames] = useState(
    formatProcessNames(settings.excludedProcessNames),
  );
  const [launchAtLogin, setLaunchAtLogin] = useState(settings.launchAtLogin);
  const [keepOpenWhenUnfocused, setKeepOpenWhenUnfocused] = useState(
    settings.keepOpenWhenUnfocused,
  );

  function saveRangesOnBlur() {
    let ranges;
    try {
      ranges = parseRanges(draftRanges);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
      onClearToast();
      return;
    }

    if (JSON.stringify(ranges) === JSON.stringify(settings.ranges)) {
      setDraftRanges(formatRanges(settings.ranges));
      return;
    }

    void onSaveSettings("ranges", {
      ...settings,
      ranges,
      launchAtLogin,
      keepOpenWhenUnfocused,
    }).catch(() => undefined);
  }

  function saveExcludedProcessNamesOnBlur() {
    const excludedProcessNames = parseProcessNames(draftExcludedProcessNames);

    if (JSON.stringify(excludedProcessNames) === JSON.stringify(settings.excludedProcessNames)) {
      setDraftExcludedProcessNames(formatProcessNames(settings.excludedProcessNames));
      return;
    }

    void onSaveSettings("excludedProcessNames", {
      ...settings,
      excludedProcessNames,
      launchAtLogin,
      keepOpenWhenUnfocused,
    }).catch(() => undefined);
  }

  function saveLaunchAtLoginOnChange(nextLaunchAtLogin: boolean) {
    const previousLaunchAtLogin = launchAtLogin;
    onClearToast();
    setLaunchAtLogin(nextLaunchAtLogin);

    void onSaveSettings("launchAtLogin", {
      ...settings,
      launchAtLogin: nextLaunchAtLogin,
      keepOpenWhenUnfocused,
    }).catch(() => setLaunchAtLogin(previousLaunchAtLogin));
  }

  function saveKeepOpenWhenUnfocusedOnChange(nextKeepOpenWhenUnfocused: boolean) {
    const previousKeepOpenWhenUnfocused = keepOpenWhenUnfocused;
    onClearToast();
    setKeepOpenWhenUnfocused(nextKeepOpenWhenUnfocused);

    void onSaveSettings("keepOpenWhenUnfocused", {
      ...settings,
      launchAtLogin,
      keepOpenWhenUnfocused: nextKeepOpenWhenUnfocused,
    }).catch(() => setKeepOpenWhenUnfocused(previousKeepOpenWhenUnfocused));
  }

  return (
    <PortsySettingsView
      activeMessage={activeMessage}
      busyKey={busyKey}
      draftExcludedProcessNames={draftExcludedProcessNames}
      draftRanges={draftRanges}
      keepOpenWhenUnfocused={keepOpenWhenUnfocused}
      launchAtLogin={launchAtLogin}
      onBack={onBack}
      onDismissMessage={onDismissMessage}
      onDraftExcludedProcessNamesBlur={saveExcludedProcessNamesOnBlur}
      onDraftExcludedProcessNamesChange={(value) => {
        onClearToast();
        setDraftExcludedProcessNames(value);
      }}
      onDraftRangesBlur={saveRangesOnBlur}
      onDraftRangesChange={(value) => {
        onClearToast();
        setDraftRanges(value);
      }}
      onKeepOpenWhenUnfocusedChange={saveKeepOpenWhenUnfocusedOnChange}
      onLaunchAtLoginChange={saveLaunchAtLoginOnChange}
      toastMessage={toastMessage}
    />
  );
}
