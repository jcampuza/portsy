import { EyeOff, LoaderCircle, RefreshCw, Settings, SquareStop } from "lucide-preact";
import type { PortsyModel } from "../app.model";
import { abbreviateWorkingDirectory, getEntryDisplayName, groupEntriesByPid } from "../lib/utils";
import { PortsyStatusMessage } from "./PortsyStatusMessage";
import { Button, Panel, Shell, ViewHeader } from "./PortsyUi";

interface PortsyMainViewProps {
  app: PortsyModel;
  onOpenSettings: () => void;
}

export function PortsyMainView({ app, onOpenSettings }: PortsyMainViewProps) {
  const entries = app.ports.entries.value;
  const processGroups = groupEntriesByPid(entries);
  const killableEntries = app.ports.killableEntries.value;
  const nonKillableEntries = app.ports.nonKillableEntries.value;
  const busyKey = app.ports.busyKey.value;
  const loading = app.loading.value;
  const notice = app.notifications.current.value;

  return (
    <Shell>
      <ViewHeader
        actions={
          <div class="flex shrink-0 items-center gap-2">
            <Button
              size="icon"
              aria-label="Refresh"
              onClick={() => void app.ports.refresh()}
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

      {notice && <PortsyStatusMessage notice={notice} onDismiss={app.notifications.clear} />}

      {app.ports.killAllConfirmationVisible.value && (
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
                  key={entry.pid}
                >
                  <strong>
                    {processGroups
                      .find((group) => group[0].pid === entry.pid)
                      ?.map((port) => port.port)
                      .join(", ")}
                  </strong> {getEntryDisplayName(entry)}{" "}
                  <span>PID {entry.pid}</span>
                </li>
              ))}
          </ul>
          {nonKillableEntries.length > 0 && (
            <p class="m-0 text-[13px] text-muted">
              {nonKillableEntries.length} watched process
              {nonKillableEntries.length === 1 ? "" : "es"} cannot be killed.
            </p>
          )}
          <div class="flex items-center justify-end gap-2">
            <Button onClick={app.ports.cancelKillAll}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => void app.ports.confirmKillAll()}
              disabled={busyKey === "kill-all"}
              aria-busy={busyKey === "kill-all"}
            >
              {busyKey === "kill-all" ? (
                <>
                  <LoaderCircle aria-hidden="true" class="mr-1.5 animate-spin" size={15} />
                  Stopping...
                </>
              ) : (
                "Confirm"
              )}
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
        {processGroups.map((group) => {
          const entry = group[0];
          const key = `${entry.pid}:${entry.port}`;
          const displayName = getEntryDisplayName(entry);
          const workingDirectory = abbreviateWorkingDirectory(entry);
          const isStopping = busyKey === key;
          return (
            <Panel
              as="article"
              class="p-2.5"
              key={entry.pid}
            >
              <div class="flex items-start justify-between gap-2.5">
                <div class="flex min-w-0 items-start gap-2.5">
                  <div class="flex max-w-[132px] shrink-0 flex-wrap gap-1">
                    {group.map((port) => (
                      <button
                        type="button"
                        class="flex h-10 min-w-[58px] items-center justify-center rounded-md bg-accent px-1 text-center font-mono text-[15px] leading-none font-bold text-white cursor-pointer hover:bg-accent-strong"
                        key={port.port}
                        aria-label={`Open port ${port.port}`}
                        title={`Open http://localhost:${port.port}`}
                        disabled={busyKey === `open:${port.pid}:${port.port}`}
                        onClick={() => void app.ports.openEntry(port)}
                      >
                        {port.port}
                      </button>
                    ))}
                  </div>
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-baseline gap-1.5 text-sm leading-tight">
                      <strong class="truncate" title={displayName}>{displayName}</strong>
                      <span class="text-xs text-muted">PID {entry.pid}</span>
                    </div>
                    <div
                      class="mt-[3px] truncate text-xs text-text"
                      title={entry.workingDirectory ?? undefined}
                    >
                      {workingDirectory ?? entry.processName}
                    </div>
                    <div class="mt-[3px] truncate text-xs text-muted" title={entry.command}>
                      {entry.processName} · {group.length === 1
                        ? entry.bindAddresses.join(", ")
                        : `${group.length} ports`}
                    </div>
                    {entry.killDisabledReason && (
                      <div class="mt-1 text-xs text-warning">{entry.killDisabledReason}</div>
                    )}
                  </div>
                </div>
                <div class="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="icon"
                    aria-label="Hide"
                    disabled={busyKey === `exclude:${entry.pid}:${entry.port}`}
                    onClick={() => void app.ports.excludeProcess(entry)}
                    title={`Hide all ${entry.processName} processes`}
                  >
                    <EyeOff aria-hidden="true" size={15} />
                  </Button>
                  <Button
                    size="icon"
                    variant="danger"
                    aria-label="Kill"
                    aria-busy={isStopping}
                    disabled={Boolean(entry.killDisabledReason) || isStopping}
                    onClick={() => void app.ports.killEntry(entry)}
                    title={isStopping ? "Stopping" : "Kill process"}
                  >
                    {isStopping ? (
                      <LoaderCircle aria-hidden="true" class="animate-spin" size={15} />
                    ) : (
                      <SquareStop aria-hidden="true" size={15} />
                    )}
                  </Button>
                </div>
              </div>
              <details class="mt-2 border-t border-border pt-1.5 text-xs">
                <summary class="cursor-pointer text-muted">Details</summary>
                <dl class="mt-2 grid gap-1.5">
                  <div>
                    <dt class="text-muted">Working directory</dt>
                    <dd class="m-0 break-all select-text">{entry.workingDirectory ?? "Unavailable"}</dd>
                  </div>
                  <div>
                    <dt class="text-muted">Command</dt>
                    <dd class="m-0 break-all select-text">{entry.command}</dd>
                  </div>
                  <div>
                    <dt class="text-muted">User</dt>
                    <dd class="m-0 select-text">{entry.user}</dd>
                  </div>
                  {group.map((port) => (
                    <div key={port.port}>
                      <dt class="text-muted">Port {port.port} · {port.protocol.toUpperCase()}</dt>
                      <dd class="m-0 break-all select-text">{port.bindAddresses.join(", ")}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </Panel>
          );
        })}
      </section>

      <footer class="bottom-actions mt-auto flex shrink-0 items-center justify-end gap-2">
        <Button
          variant="danger"
          disabled={killableEntries.length === 0 || busyKey === "kill-all"}
          onClick={app.ports.showKillAll}
        >
          Kill All Watched
        </Button>
      </footer>
    </Shell>
  );
}
