import { useState } from "preact/hooks";
import type {
  AppSettings,
  KillOutcome,
  KillReport,
  PortEntry,
  PortSnapshot,
} from "../lib/types";
import { PortsyMainView } from "./PortsyMainView";
import { PortsySettingsView } from "./PortsySettingsView";
import {
  formatProcessNames,
  formatRanges,
  parseProcessNames,
  parseRanges,
} from "../lib/utils";

export {
  formatProcessNames,
  formatRanges,
  getEntryDisplayName,
  parseProcessNames,
  parseRanges,
} from "../lib/utils";

interface PortsyPanelProps {
  snapshot: PortSnapshot | null;
  settings: AppSettings;
  loading: boolean;
  message: string | null;
  onRefresh: () => void;
  onKillPort: (entry: PortEntry) => Promise<KillReport>;
  onKillAll: (snapshot: PortSnapshot) => Promise<KillOutcome[]>;
  onSaveSettings: (settings: AppSettings) => Promise<AppSettings>;
}

type View = "main" | "settings";

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
  const [view, setView] = useState<View>("main");
  const [confirmKillAll, setConfirmKillAll] = useState(false);
  const [draftRanges, setDraftRanges] = useState(formatRanges(settings.ranges));
  const [draftExcludedProcessNames, setDraftExcludedProcessNames] = useState(
    formatProcessNames(settings.excludedProcessNames),
  );
  const [launchAtLogin, setLaunchAtLogin] = useState(settings.launchAtLogin);
  const [keepOpenWhenUnfocused, setKeepOpenWhenUnfocused] = useState(
    settings.keepOpenWhenUnfocused,
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  const entries = snapshot?.entries ?? [];
  const activeMessage = localMessage ?? message;
  const disabledKillAll = entries.filter((entry) => entry.killDisabledReason);
  const killableEntries = entries.filter((entry) => !entry.killDisabledReason);

  function openSettings() {
    setDraftRanges(formatRanges(settings.ranges));
    setDraftExcludedProcessNames(formatProcessNames(settings.excludedProcessNames));
    setLaunchAtLogin(settings.launchAtLogin);
    setKeepOpenWhenUnfocused(settings.keepOpenWhenUnfocused);
    setConfirmKillAll(false);
    setView("settings");
  }

  async function saveDraftSettings() {
    const ranges = parseRanges(draftRanges);
    setBusyKey("settings");
    try {
      const saved = await onSaveSettings({
        ...settings,
        ranges,
        excludedProcessNames: parseProcessNames(draftExcludedProcessNames),
        launchAtLogin,
        keepOpenWhenUnfocused,
      });
      setDraftRanges(formatRanges(saved.ranges));
      setDraftExcludedProcessNames(formatProcessNames(saved.excludedProcessNames));
      setLocalMessage("Settings saved.");
      setView("main");
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function excludeProcess(entry: PortEntry) {
    const processName = entry.processName.trim();
    if (!processName) return;
    const existingNames = new Set(settings.excludedProcessNames.map((name) => name.toLowerCase()));
    const excludedProcessNames = existingNames.has(processName.toLowerCase())
      ? settings.excludedProcessNames
      : [...settings.excludedProcessNames, processName].sort((left, right) =>
          left.localeCompare(right),
        );

    setBusyKey(`exclude:${entry.pid}:${entry.port}`);
    try {
      const saved = await onSaveSettings({
        ...settings,
        excludedProcessNames,
      });
      setDraftExcludedProcessNames(formatProcessNames(saved.excludedProcessNames));
      setLocalMessage(`Excluded ${processName}.`);
      onRefresh();
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function killEntry(entry: PortEntry) {
    const key = `${entry.pid}:${entry.port}`;
    setBusyKey(key);
    try {
      const report = await onKillPort(entry);
      setLocalMessage(report.message);
      onRefresh();
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function killAllConfirmed() {
    if (!snapshot) return;
    setBusyKey("kill-all");
    try {
      const outcomes = await onKillAll(snapshot);
      const failed = outcomes.filter((outcome) => !outcome.ok);
      const killed = outcomes.filter((outcome) => outcome.ok).length;
      setLocalMessage(
        failed.length === 0
          ? `Killed ${killed} watched process${killed === 1 ? "" : "es"}.`
          : `Killed ${killed}; ${failed.length} failed.`,
      );
      setConfirmKillAll(false);
      onRefresh();
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(null);
    }
  }

  if (view === "settings") {
    return (
      <PortsySettingsView
        activeMessage={activeMessage}
        busyKey={busyKey}
        draftExcludedProcessNames={draftExcludedProcessNames}
        draftRanges={draftRanges}
        keepOpenWhenUnfocused={keepOpenWhenUnfocused}
        launchAtLogin={launchAtLogin}
        onBack={() => setView("main")}
        onDismissMessage={() => setLocalMessage(null)}
        onDraftExcludedProcessNamesChange={setDraftExcludedProcessNames}
        onDraftRangesChange={setDraftRanges}
        onKeepOpenWhenUnfocusedChange={setKeepOpenWhenUnfocused}
        onLaunchAtLoginChange={setLaunchAtLogin}
        onSaveSettings={saveDraftSettings}
      />
    );
  }

  return (
    <PortsyMainView
      activeMessage={activeMessage}
      busyKey={busyKey}
      confirmKillAll={confirmKillAll}
      disabledKillAll={disabledKillAll}
      entries={entries}
      killableEntries={killableEntries}
      loading={loading}
      onCancelKillAll={() => setConfirmKillAll(false)}
      onConfirmKillAll={killAllConfirmed}
      onDismissMessage={() => setLocalMessage(null)}
      onExcludeProcess={excludeProcess}
      onKillEntry={killEntry}
      onOpenSettings={openSettings}
      onRefresh={onRefresh}
      onShowKillAll={() => setConfirmKillAll(true)}
    />
  );
}
