import type { PortsyModel } from "../app.model";
import { PortsyStatusMessage } from "./PortsyStatusMessage";
import { Button, FieldLabel, Panel, Shell, TextArea, TextInput, ViewHeader } from "./PortsyUi";

interface PortsySettingsViewProps {
  app: PortsyModel;
  onBack: () => void;
}

export function PortsySettingsView({ app, onBack }: PortsySettingsViewProps) {
  const draft = app.settingsDraft;
  const busyKey = draft.busyKey.value;
  const notice = app.notifications.current.value;

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

      {notice && <PortsyStatusMessage notice={notice} onDismiss={app.notifications.clear} />}

      <Panel
        aria-label="Settings"
        as="section"
        class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto p-3"
      >
        <FieldLabel>
          Port ranges
          <TextInput
            value={draft.draftRanges.value}
            onInput={(event) => draft.setDraftRanges(event.currentTarget.value)}
            onBlur={draft.saveRangesOnBlur}
            placeholder="3000-9999, 5173"
          />
        </FieldLabel>
        <label class="flex items-center gap-2 text-sm text-text">
          <input
            class="h-4 w-4 accent-accent"
            type="checkbox"
            checked={draft.launchAtLogin.value}
            disabled={busyKey === "launchAtLogin"}
            onChange={(event) => draft.saveLaunchAtLoginOnChange(event.currentTarget.checked)}
          />
          Launch at login
        </label>
        <label class="flex items-center gap-2 text-sm text-text">
          <input
            class="h-4 w-4 accent-accent"
            type="checkbox"
            checked={draft.keepOpenWhenUnfocused.value}
            disabled={busyKey === "keepOpenWhenUnfocused"}
            onChange={(event) =>
              draft.saveKeepOpenWhenUnfocusedOnChange(event.currentTarget.checked)
            }
          />
          Keep open when unfocused
        </label>
        <FieldLabel>
          Excluded processes
          <TextArea
            value={draft.draftExcludedProcessNames.value}
            onInput={(event) => draft.setDraftExcludedProcessNames(event.currentTarget.value)}
            onBlur={draft.saveExcludedProcessNamesOnBlur}
            placeholder="Google Chrome, Hammerspoon, Raycast"
          />
        </FieldLabel>
      </Panel>
    </Shell>
  );
}
