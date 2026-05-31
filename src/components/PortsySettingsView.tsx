import { PortsyStatusMessage } from "./PortsyStatusMessage";
import { Button, FieldLabel, Panel, Shell, TextArea, TextInput, ViewHeader } from "./PortsyUi";

interface PortsySettingsViewProps {
  activeMessage: string | null;
  busyKey: string | null;
  draftExcludedProcessNames: string;
  draftRanges: string;
  keepOpenWhenUnfocused: boolean;
  launchAtLogin: boolean;
  toastMessage: string | null;
  onBack: () => void;
  onDismissMessage: () => void;
  onDraftExcludedProcessNamesBlur: () => void;
  onDraftExcludedProcessNamesChange: (value: string) => void;
  onDraftRangesBlur: () => void;
  onDraftRangesChange: (value: string) => void;
  onKeepOpenWhenUnfocusedChange: (value: boolean) => void;
  onLaunchAtLoginChange: (value: boolean) => void;
}

export function PortsySettingsView({
  activeMessage,
  busyKey,
  draftExcludedProcessNames,
  draftRanges,
  keepOpenWhenUnfocused,
  launchAtLogin,
  toastMessage,
  onBack,
  onDismissMessage,
  onDraftExcludedProcessNamesBlur,
  onDraftExcludedProcessNamesChange,
  onDraftRangesBlur,
  onDraftRangesChange,
  onKeepOpenWhenUnfocusedChange,
  onLaunchAtLoginChange,
}: PortsySettingsViewProps) {
  return (
    <Shell>
      <ViewHeader
        leading={
          <Button class="shrink-0" onClick={onBack}>
            Back
          </Button>
        }
        subtitle="Configure watched ports and hidden processes"
        title="Settings"
        variant="back"
      />

      {activeMessage && (
        <PortsyStatusMessage message={activeMessage} onDismiss={onDismissMessage} />
      )}

      <Panel
        aria-label="Settings"
        as="section"
        class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto p-3"
      >
        <FieldLabel>
          Port ranges
          <TextInput
            value={draftRanges}
            onInput={(event) => onDraftRangesChange(event.currentTarget.value)}
            onBlur={onDraftRangesBlur}
            placeholder="3000-9999, 5173"
          />
        </FieldLabel>
        <label class="flex items-center gap-2 text-sm text-text">
          <input
            class="h-4 w-4 accent-accent"
            type="checkbox"
            checked={launchAtLogin}
            disabled={busyKey === "launchAtLogin"}
            onChange={(event) => onLaunchAtLoginChange(event.currentTarget.checked)}
          />
          Launch at login
        </label>
        <label class="flex items-center gap-2 text-sm text-text">
          <input
            class="h-4 w-4 accent-accent"
            type="checkbox"
            checked={keepOpenWhenUnfocused}
            disabled={busyKey === "keepOpenWhenUnfocused"}
            onChange={(event) => onKeepOpenWhenUnfocusedChange(event.currentTarget.checked)}
          />
          Keep open when unfocused
        </label>
        <FieldLabel>
          Excluded processes
          <TextArea
            value={draftExcludedProcessNames}
            onInput={(event) => onDraftExcludedProcessNamesChange(event.currentTarget.value)}
            onBlur={onDraftExcludedProcessNamesBlur}
            placeholder="Google Chrome, Hammerspoon, Raycast"
          />
        </FieldLabel>
      </Panel>

      {toastMessage && (
        <div
          class="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-border bg-panel px-3 py-2 text-sm text-success shadow-lg"
          role="status"
        >
          {toastMessage}
        </div>
      )}
    </Shell>
  );
}
