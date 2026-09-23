import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortsyModel, type PortsyModel as PortsyModelInstance } from "../app.model";
import { defaultSettings, type PortEntry, type PortSnapshot } from "../lib/types";
import { getEntryDisplayName, parseProcessNames, parseRanges } from "../lib/utils";
import { PortsyMainView } from "./PortsyMainView";
import { PortsySettingsView } from "./PortsySettingsView";

const tauri = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getSnapshot: vi.fn(),
  killAllWatched: vi.fn(),
  killPort: vi.fn(),
  openPort: vi.fn(),
  onSnapshot: vi.fn(),
  saveSettings: vi.fn(),
  startMonitor: vi.fn(),
}));

vi.mock("../lib/tauri", () => tauri);

const baseEntry: PortEntry = {
  protocol: "tcp",
  port: 5173,
  pid: 123,
  processName: "node",
  command: "node ./node_modules/.bin/vite --port 5173",
  workingDirectory: "/Users/joseph/code/board-c",
  user: "joseph",
  bindAddresses: ["127.0.0.1"],
  killDisabledReason: null,
};

const loadedSettings = {
  ...defaultSettings,
  lastUpdatedAt: 1,
};

const activeModels: PortsyModelInstance[] = [];

function snapshot(entries: PortEntry[]): PortSnapshot {
  return {
    scannedAtMs: 1,
    ranges: defaultSettings.ranges,
    entries,
  };
}

async function createStartedModel(entries: PortEntry[] = []) {
  tauri.getSettings.mockResolvedValue(loadedSettings);
  tauri.getSnapshot.mockResolvedValue(snapshot(entries));
  tauri.onSnapshot.mockReturnValue(Promise.resolve(vi.fn()));
  tauri.startMonitor.mockResolvedValue(undefined);
  tauri.saveSettings.mockImplementation(async (settings) => ({
    ...settings,
    lastUpdatedAt: settings.lastUpdatedAt + 1,
  }));
  tauri.killPort.mockResolvedValue({
    port: 5173,
    pid: 123,
    processName: "node",
    terminated: true,
    forced: false,
    message: "Sent SIGTERM and the port was released.",
  });
  tauri.killAllWatched.mockResolvedValue([]);
  tauri.openPort.mockResolvedValue("http://localhost:5173");

  const model = new PortsyModel();
  activeModels.push(model);
  await model.start();
  return model;
}

async function renderHomePanel(entries: PortEntry[] = []) {
  const model = await createStartedModel(entries);
  return {
    model,
    ...render(<PortsyMainView app={model} onOpenSettings={vi.fn()} />),
  };
}

async function renderSettingsPanel() {
  const model = await createStartedModel();
  return {
    model,
    ...render(<PortsySettingsView app={model} onBack={vi.fn()} />),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  activeModels.splice(0).forEach((model) => model.stop());
  cleanup();
});

describe("PortsyMainView", () => {
  it("renders the empty state", async () => {
    await renderHomePanel();

    expect(screen.getByText("No watched TCP listeners found.")).toBeTruthy();
  });

  it("renders a populated port row", async () => {
    await renderHomePanel([baseEntry]);

    expect(screen.getByText("5173")).toBeTruthy();
    expect(screen.getByText("Board C")).toBeTruthy();
    expect(screen.getByText("~/code/board-c")).toBeTruthy();
    expect(screen.getByText("PID 123")).toBeTruthy();
    const details = screen.getByText("Details").closest("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByText("Details"));
    expect(details.open).toBe(true);
    expect(screen.getByText(baseEntry.command)).toBeTruthy();
    expect(screen.getByText(baseEntry.workingDirectory!)).toBeTruthy();
  });

  it("groups ports owned by the same process and opens each port", async () => {
    await renderHomePanel([baseEntry, { ...baseEntry, port: 5174 }]);

    expect(screen.getAllByText("PID 123")).toHaveLength(1);
    expect(screen.getByText("5174")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open port 5174" }));
    await waitFor(() => expect(tauri.openPort).toHaveBeenCalledWith(5174));

    fireEvent.click(screen.getByRole("button", { name: "Kill All Watched" }));
    expect(screen.getByText("1 process will receive SIGTERM.")).toBeTruthy();
    expect(screen.getByText("5173, 5174")).toBeTruthy();
  });

  it("disables kill for protected rows", async () => {
    await renderHomePanel([
      {
        ...baseEntry,
        killDisabledReason: "Root-owned process; Portsy will not request sudo.",
      },
    ]);

    expect(screen.getByRole("button", { name: "Kill" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Root-owned process; Portsy will not request sudo.")).toBeTruthy();
  });

  it("shows the row stop action as busy while killing a port", async () => {
    let resolveKill!: (report: Awaited<ReturnType<typeof tauri.killPort>>) => void;
    const killPromise = new Promise<Awaited<ReturnType<typeof tauri.killPort>>>((resolve) => {
      resolveKill = resolve;
    });
    tauri.killPort.mockReturnValue(killPromise);

    await renderHomePanel([baseEntry]);

    fireEvent.click(screen.getByRole("button", { name: "Kill" }));

    await waitFor(() => {
      const button = screen.getByRole("button", { name: "Kill" });
      expect(button).toHaveProperty("disabled", true);
      expect(button.getAttribute("aria-busy")).toBe("true");
      expect(button.getAttribute("title")).toBe("Stopping");
    });

    resolveKill({
      port: 5173,
      pid: 123,
      processName: "node",
      terminated: true,
      forced: false,
      message: "Sent SIGTERM and the port was released.",
    });
    await waitFor(() => expect(tauri.killPort).toHaveBeenCalledWith(123, 5173));
  });

  it("confirms kill all before invoking the action", async () => {
    tauri.killAllWatched.mockResolvedValue([
      {
        ok: true,
        report: {
          port: 5173,
          pid: 123,
          processName: "node",
          terminated: true,
          forced: false,
          message: "done",
        },
        error: null,
      },
    ]);

    await renderHomePanel([baseEntry]);

    fireEvent.click(screen.getByRole("button", { name: "Kill All Watched" }));
    expect(tauri.killAllWatched).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(tauri.killAllWatched).toHaveBeenCalledOnce());
  });

  it("uses the settings action to leave the home panel", async () => {
    const model = await createStartedModel([baseEntry]);
    const onOpenSettings = vi.fn();

    render(<PortsyMainView app={model} onOpenSettings={onOpenSettings} />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Watched ports")).toBeTruthy();
  });

  it("clears app messages from the home panel dismiss action", async () => {
    const model = await createStartedModel();
    model.notifications.error("Refresh failed.");

    render(<PortsyMainView app={model} onOpenSettings={vi.fn()} />);

    const toast = screen.getByRole("status");
    expect(toast.className).toContain("fixed");
    expect(toast.className).toContain("bottom-3");
    expect(toast.className).toContain("left-3");
    expect(toast.className).toContain("text-danger");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));

    expect(model.notifications.current.value).toBeNull();
  });

  it("clears app messages after three seconds", async () => {
    vi.useFakeTimers();
    const model = await createStartedModel();
    model.notifications.error("Refresh failed.");

    render(<PortsyMainView app={model} onOpenSettings={vi.fn()} />);

    expect(screen.getByRole("status")).toBeTruthy();
    expect(model.notifications.current.value).not.toBeNull();

    vi.advanceTimersByTime(2_999);
    expect(model.notifications.current.value).not.toBeNull();

    vi.advanceTimersByTime(1);
    await waitFor(() => expect(model.notifications.current.value).toBeNull());
  });

  it("does not restart the toast timer when the view rerenders with the same notice", async () => {
    vi.useFakeTimers();
    const model = await createStartedModel();
    model.notifications.error("Refresh failed.");

    const { rerender } = render(<PortsyMainView app={model} onOpenSettings={vi.fn()} />);

    vi.advanceTimersByTime(2_000);
    rerender(<PortsyMainView app={model} onOpenSettings={vi.fn()} />);
    vi.advanceTimersByTime(999);
    expect(model.notifications.current.value).not.toBeNull();

    vi.advanceTimersByTime(1);
    await waitFor(() => expect(model.notifications.current.value).toBeNull());
  });

  it("keeps kill all in the bottom action area on the main view", async () => {
    await renderHomePanel([baseEntry]);

    const button = screen.getByRole("button", { name: "Kill All Watched" });
    const footer = button.closest("footer");
    expect(footer).toBeTruthy();
    expect(footer?.className).toContain("justify-end");
    expect(button.className).not.toContain("w-full");
  });

  it("opens a port in the default browser", async () => {
    await renderHomePanel([baseEntry]);

    fireEvent.click(screen.getByRole("button", { name: "Open port 5173" }));

    await waitFor(() => expect(tauri.openPort).toHaveBeenCalledWith(5173));
    expect(screen.queryByText("Opened port 5173.")).toBeNull();
  });
});

describe("PortsySettingsView", () => {
  it("renders settings without the watched ports panel", async () => {
    await renderSettingsPanel();

    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.queryByLabelText("Watched ports")).toBeNull();
  });

  it("clears app messages from the settings dismiss action", async () => {
    const model = await createStartedModel();
    model.notifications.error("Save failed.");

    render(<PortsySettingsView app={model} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));

    expect(model.notifications.current.value).toBeNull();
  });

  it("saves the keep-open development setting when toggled", async () => {
    const onBack = vi.fn();
    const model = await createStartedModel();

    render(<PortsySettingsView app={model} onBack={onBack} />);

    fireEvent.click(screen.getByLabelText("Keep open when unfocused"));

    await waitFor(() =>
      expect(tauri.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ keepOpenWhenUnfocused: true }),
      ),
    );
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save Settings" })).toBeNull();
    expect(screen.queryByText("Settings saved.")).toBeNull();
  });

  it("resets local settings drafts only when the settings revision changes", async () => {
    const model = await createStartedModel();
    const firstSettings = {
      ...defaultSettings,
      lastUpdatedAt: 1,
    };
    const nextSettings = {
      ...defaultSettings,
      lastUpdatedAt: 2,
      ranges: [{ start: 4000, end: 4002 }],
      launchAtLogin: true,
      keepOpenWhenUnfocused: true,
      excludedProcessNames: ["Raycast"],
    };

    render(<PortsySettingsView app={model} onBack={vi.fn()} />);

    fireEvent.input(screen.getByLabelText("Port ranges"), {
      target: { value: "draft value" },
    });

    tauri.saveSettings.mockImplementationOnce(async (settings) => settings);
    await model.saveSettings({ ...nextSettings, lastUpdatedAt: firstSettings.lastUpdatedAt });

    expect((screen.getByLabelText("Port ranges") as HTMLInputElement).value).toBe("draft value");

    await model.saveSettings(nextSettings);

    await waitFor(() =>
      expect((screen.getByLabelText("Port ranges") as HTMLInputElement).value).toBe("4000-4002"),
    );
    expect((screen.getByLabelText("Excluded processes") as HTMLTextAreaElement).value).toBe(
      "Raycast",
    );
    expect((screen.getByLabelText("Launch at login") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Keep open when unfocused") as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("saves port ranges on blur", async () => {
    await renderSettingsPanel();

    fireEvent.input(screen.getByLabelText("Port ranges"), {
      target: { value: "4000-4002, 5173" },
    });
    fireEvent.blur(screen.getByLabelText("Port ranges"));

    await waitFor(() =>
      expect(tauri.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          ranges: [
            { start: 4000, end: 4002 },
            { start: 5173, end: 5173 },
          ],
        }),
      ),
    );
  });

  it("saves excluded processes on blur", async () => {
    await renderSettingsPanel();

    fireEvent.input(screen.getByLabelText("Excluded processes"), {
      target: { value: "Raycast, Google Chrome" },
    });
    fireEvent.blur(screen.getByLabelText("Excluded processes"));

    await waitFor(() =>
      expect(tauri.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          excludedProcessNames: ["Google Chrome", "Raycast"],
        }),
      ),
    );
  });

  it("uses the back action to leave settings", async () => {
    const model = await createStartedModel();
    const onBack = vi.fn();

    render(<PortsySettingsView app={model} onBack={onBack} />);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe("settings parsing and display helpers", () => {
  it("parses settings range input", () => {
    expect(parseRanges("3000-3002, 5173")).toEqual([
      { start: 3000, end: 3002 },
      { start: 5173, end: 5173 },
    ]);
  });

  it("parses excluded process names", () => {
    expect(parseProcessNames("Google Chrome, Hammerspoon, Google Chrome")).toEqual([
      "Google Chrome",
      "Hammerspoon",
    ]);
  });

  it("uses a project name for node commands", () => {
    expect(
      getEntryDisplayName({
        ...baseEntry,
        workingDirectory: null,
        command: "node /Users/josephcampuzano/me/portless/node_modules/.bin/vite --port 5173",
      }),
    ).toBe("Portless");
  });

  it("uses mac app bundle names when available", () => {
    expect(
      getEntryDisplayName({
        ...baseEntry,
        processName: "Google Chrome",
        command:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9222",
      }),
    ).toBe("Google Chrome");
  });

  it("keeps generic names when the directory is a home folder", () => {
    expect(getEntryDisplayName({ ...baseEntry, workingDirectory: "/Users/joseph", command: "node" })).toBe("node");
  });
});
