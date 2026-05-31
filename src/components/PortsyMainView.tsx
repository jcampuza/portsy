import { ExternalLink, EyeOff, RefreshCw, Settings, SquareStop } from "lucide-preact";
import type { PortEntry } from "../lib/types";
import { PortsyStatusMessage } from "./PortsyStatusMessage";
import { Button, Panel, Shell, ViewHeader } from "./PortsyUi";
import { getEntryDisplayName } from "../lib/utils";

interface PortsyMainViewProps {
  activeMessage: string | null;
  busyKey: string | null;
  confirmKillAll: boolean;
  disabledKillAll: PortEntry[];
  entries: PortEntry[];
  killableEntries: PortEntry[];
  loading: boolean;
  onCancelKillAll: () => void;
  onConfirmKillAll: () => void;
  onDismissMessage: () => void;
  onExcludeProcess: (entry: PortEntry) => void;
  onKillEntry: (entry: PortEntry) => void;
  onOpenEntry: (entry: PortEntry) => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
  onShowKillAll: () => void;
}

export function PortsyMainView({
  activeMessage,
  busyKey,
  confirmKillAll,
  disabledKillAll,
  entries,
  killableEntries,
  loading,
  onCancelKillAll,
  onConfirmKillAll,
  onDismissMessage,
  onExcludeProcess,
  onKillEntry,
  onOpenEntry,
  onOpenSettings,
  onRefresh,
  onShowKillAll,
}: PortsyMainViewProps) {
  return (
    <Shell>
      <ViewHeader
        actions={
          <div class="flex shrink-0 items-center gap-2">
            <Button
              size="icon"
              aria-label="Refresh"
              onClick={onRefresh}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw aria-hidden="true" size={16} />
            </Button>
            <Button size="icon" aria-label="Settings" onClick={onOpenSettings} title="Settings">
              <Settings aria-hidden="true" size={16} />
            </Button>
          </div>
        }
        subtitle={`${entries.length} watched TCP port${entries.length === 1 ? "" : "s"} in use`}
        title="Portsy"
      />

      {activeMessage && (
        <PortsyStatusMessage message={activeMessage} onDismiss={onDismissMessage} />
      )}

      {confirmKillAll && (
        <Panel
          as="section"
          class="flex flex-col gap-2.5 p-3"
          role="dialog"
          aria-label="Confirm kill all"
        >
          <h2 class="m-0 text-base font-semibold">Confirm Kill All</h2>
          <p class="m-0 text-[13px] text-muted">
            {killableEntries.length} process{killableEntries.length === 1 ? "" : "es"} will receive
            SIGTERM.
          </p>
          <ul class="m-0 max-h-[150px] list-none overflow-auto p-0">
            {killableEntries.map((entry) => (
              <li
                class="flex justify-between gap-2.5 border-b border-border py-1.5 text-[13px]"
                key={`${entry.pid}:${entry.port}`}
              >
                <strong>{entry.port}</strong> {getEntryDisplayName(entry)}{" "}
                <span>PID {entry.pid}</span>
              </li>
            ))}
          </ul>
          {disabledKillAll.length > 0 && (
            <p class="m-0 text-[13px] text-muted">
              {disabledKillAll.length} watched row{disabledKillAll.length === 1 ? "" : "s"} cannot
              be killed.
            </p>
          )}
          <div class="flex items-center justify-end gap-2">
            <Button onClick={onCancelKillAll}>Cancel</Button>
            <Button variant="danger" onClick={onConfirmKillAll} disabled={busyKey === "kill-all"}>
              Confirm
            </Button>
          </div>
        </Panel>
      )}

      <section class="flex min-h-0 flex-1 flex-col gap-2 overflow-auto" aria-label="Watched ports">
        {loading && entries.length === 0 && (
          <Panel class="px-4 py-7 text-center text-muted">Scanning watched ports...</Panel>
        )}
        {!loading && entries.length === 0 && (
          <Panel class="px-4 py-7 text-center text-muted">No watched TCP listeners found.</Panel>
        )}
        {entries.map((entry) => {
          const key = `${entry.pid}:${entry.port}`;
          const displayName = getEntryDisplayName(entry);
          return (
            <Panel
              as="article"
              class="flex items-start justify-between gap-2.5 p-2.5"
              key={key}
            >
              <div class="flex min-w-0 items-start gap-2.5">
                <div class="flex h-10 w-[58px] shrink-0 items-center justify-center rounded-md bg-accent px-1 text-center font-mono text-[15px] leading-none font-bold text-white">
                  {entry.port}
                </div>
                <div class="min-w-0">
                  <div class="flex flex-wrap items-baseline gap-1.5 text-sm leading-tight">
                    <strong title={entry.command}>{displayName}</strong>
                    <span class="text-xs text-muted">PID {entry.pid}</span>
                  </div>
                  <div
                    class="mt-[3px] max-w-60 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-text"
                    title={entry.command}
                  >
                    {entry.processName}
                  </div>
                  <div class="mt-[3px] text-xs text-muted">
                    {entry.bindAddresses.join(", ")} | {entry.user}
                  </div>
                  {entry.killDisabledReason && (
                    <div class="mt-1 text-xs text-warning">{entry.killDisabledReason}</div>
                  )}
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <Button
                  size="icon"
                  aria-label="Open"
                  disabled={busyKey === `open:${entry.pid}:${entry.port}`}
                  onClick={() => onOpenEntry(entry)}
                  title="Open"
                >
                  <ExternalLink aria-hidden="true" size={15} />
                </Button>
                <Button
                  size="icon"
                  aria-label="Hide"
                  disabled={busyKey === `exclude:${entry.pid}:${entry.port}`}
                  onClick={() => onExcludeProcess(entry)}
                  title="Hide"
                >
                  <EyeOff aria-hidden="true" size={15} />
                </Button>
                <Button
                  size="icon"
                  variant="danger"
                  aria-label="Kill"
                  disabled={Boolean(entry.killDisabledReason) || busyKey === key}
                  onClick={() => onKillEntry(entry)}
                  title="Kill"
                >
                  <SquareStop aria-hidden="true" size={15} />
                </Button>
              </div>
            </Panel>
          );
        })}
      </section>

      <footer class="bottom-actions mt-auto flex shrink-0 items-center justify-end gap-2">
        <Button
          variant="danger"
          disabled={killableEntries.length === 0 || busyKey === "kill-all"}
          onClick={onShowKillAll}
        >
          Kill All Watched
        </Button>
      </footer>
    </Shell>
  );
}
