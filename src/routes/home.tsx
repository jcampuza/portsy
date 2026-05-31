import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { useApp } from "../app.provider";
import { PortsyMainView } from "../components/PortsyMainView";
import type {
  AppSettings,
  KillOutcome,
  KillReport,
  PortEntry,
  PortSnapshot,
} from "../lib/types";

export const HomeRoute = () => {
  const app = useApp();
  const location = useLocation();

  return (
    <HomeRouteView
      snapshot={app.snapshot.value}
      settings={app.settings.value}
      loading={app.loading.value}
      message={app.message.value}
      onRefresh={() => void app.refresh()}
      onKillPort={(entry) => app.killPort(entry)}
      onKillAll={app.killAllWatched}
      onOpenPort={(entry) => app.openPort(entry)}
      onOpenSettings={() => location.route("/settings")}
      onSaveSettings={(nextSettings) => {
        return app.saveSettings(nextSettings);
      }}
    />
  );
};

interface HomeRouteViewProps {
  snapshot: PortSnapshot | null;
  settings: AppSettings;
  loading: boolean;
  message: string | null;
  onRefresh: () => void;
  onKillPort: (entry: PortEntry) => Promise<KillReport>;
  onKillAll: (snapshot: PortSnapshot) => Promise<KillOutcome[]>;
  onOpenPort: (entry: PortEntry) => Promise<string>;
  onOpenSettings: () => void;
  onSaveSettings: (settings: AppSettings) => Promise<AppSettings>;
}

export function HomeRouteView({
  snapshot,
  settings,
  loading,
  message,
  onRefresh,
  onKillPort,
  onKillAll,
  onOpenPort,
  onOpenSettings,
  onSaveSettings,
}: HomeRouteViewProps) {
  const [confirmKillAll, setConfirmKillAll] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  const entries = snapshot?.entries ?? [];
  const activeMessage = localMessage ?? message;
  const disabledKillAll = entries.filter((entry) => entry.killDisabledReason);
  const killableEntries = entries.filter((entry) => !entry.killDisabledReason);

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
      await onSaveSettings({
        ...settings,
        excludedProcessNames,
      });
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

  async function openEntry(entry: PortEntry) {
    const key = `open:${entry.pid}:${entry.port}`;
    setBusyKey(key);
    try {
      await onOpenPort(entry);
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
      onOpenEntry={openEntry}
      onOpenSettings={onOpenSettings}
      onRefresh={onRefresh}
      onShowKillAll={() => setConfirmKillAll(true)}
    />
  );
}
