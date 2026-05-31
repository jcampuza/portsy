import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, type KillReport, type PortEntry, type PortSnapshot } from "../lib/types";
import { getEntryDisplayName, parseProcessNames, parseRanges } from "../lib/utils";
import { HomeRouteView } from "../routes/home";
import { SettingsRouteView } from "../routes/settings";

const baseEntry: PortEntry = {
  protocol: "tcp",
  port: 5173,
  pid: 123,
  processName: "node",
  command: "node ./node_modules/.bin/vite --port 5173",
  user: "joseph",
  bindAddresses: ["127.0.0.1"],
  killDisabledReason: null,
};

function snapshot(entries: PortEntry[]): PortSnapshot {
  return {
    scannedAtMs: 1,
    ranges: defaultSettings.ranges,
    entries,
  };
}

function renderHomePanel(entries: PortEntry[] = []) {
  return render(
    <HomeRouteView
      snapshot={snapshot(entries)}
      settings={defaultSettings}
      loading={false}
      message={null}
      onRefresh={vi.fn()}
      onKillPort={vi.fn().mockResolvedValue({
        port: 5173,
        pid: 123,
        processName: "node",
        terminated: true,
        forced: false,
        message: "Sent SIGTERM and the port was released.",
      })}
      onKillAll={vi.fn().mockResolvedValue([])}
      onOpenPort={vi.fn().mockResolvedValue("http://localhost:5173")}
      onOpenSettings={vi.fn()}
      onSaveSettings={vi.fn().mockImplementation(async (settings) => settings)}
    />,
  );
}

function renderSettingsPanel() {
  return render(
    <SettingsRouteView
      settings={defaultSettings}
      message={null}
      onBack={vi.fn()}
      onSaveSettings={vi.fn().mockImplementation(async (settings) => settings)}
    />,
  );
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("HomeRouteView", () => {
  it("renders the empty state", () => {
    renderHomePanel();

    expect(screen.getByText("No watched TCP listeners found.")).toBeTruthy();
  });

  it("renders a populated port row", () => {
    renderHomePanel([baseEntry]);

    expect(screen.getByText("5173")).toBeTruthy();
    expect(screen.getAllByText("node").length).toBeGreaterThan(0);
    expect(screen.getByText("PID 123")).toBeTruthy();
  });

  it("disables kill for protected rows", () => {
    renderHomePanel([
      {
        ...baseEntry,
        killDisabledReason: "Root-owned process; Portsy will not request sudo.",
      },
    ]);

    expect(screen.getByRole("button", { name: "Kill" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Root-owned process; Portsy will not request sudo.")).toBeTruthy();
  });

  it("shows the row stop action as busy while killing a port", async () => {
    let resolveKill!: (report: KillReport) => void;
    const killPromise = new Promise<KillReport>((resolve) => {
      resolveKill = resolve;
    });
    const onKillPort = vi.fn(() => killPromise);

    render(
      <HomeRouteView
        snapshot={snapshot([baseEntry])}
        settings={defaultSettings}
        loading={false}
        message={null}
        onRefresh={vi.fn()}
        onKillPort={onKillPort}
        onKillAll={vi.fn()}
        onOpenPort={vi.fn()}
        onOpenSettings={vi.fn()}
        onSaveSettings={vi.fn()}
      />,
    );

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
    await waitFor(() => expect(onKillPort).toHaveBeenCalledWith(baseEntry));
  });

  it("confirms kill all before invoking the action", async () => {
    const onKillAll = vi.fn().mockResolvedValue([
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

    render(
      <HomeRouteView
        snapshot={snapshot([baseEntry])}
        settings={defaultSettings}
        loading={false}
        message={null}
        onRefresh={vi.fn()}
        onKillPort={vi.fn()}
        onKillAll={onKillAll}
        onOpenPort={vi.fn()}
        onOpenSettings={vi.fn()}
        onSaveSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Kill All Watched" }));
    expect(onKillAll).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(onKillAll).toHaveBeenCalledOnce());
  });

  it("uses the settings action to leave the home panel", () => {
    const onOpenSettings = vi.fn();

    render(
      <HomeRouteView
        snapshot={snapshot([baseEntry])}
        settings={defaultSettings}
        loading={false}
        message={null}
        onRefresh={vi.fn()}
        onKillPort={vi.fn()}
        onKillAll={vi.fn()}
        onOpenPort={vi.fn()}
        onOpenSettings={onOpenSettings}
        onSaveSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Watched ports")).toBeTruthy();
  });

  it("clears app messages from the home panel dismiss action", () => {
    const onClearMessage = vi.fn();

    render(
      <HomeRouteView
        snapshot={snapshot([])}
        settings={defaultSettings}
        loading={false}
        message="Refresh failed."
        onClearMessage={onClearMessage}
        onRefresh={vi.fn()}
        onKillPort={vi.fn()}
        onKillAll={vi.fn()}
        onOpenPort={vi.fn()}
        onOpenSettings={vi.fn()}
        onSaveSettings={vi.fn()}
      />,
    );

    const toast = screen.getByRole("status");
    expect(toast.className).toContain("fixed");
    expect(toast.className).toContain("bottom-3");
    expect(toast.className).toContain("left-3");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));

    expect(onClearMessage).toHaveBeenCalledOnce();
  });

  it("clears app messages after three seconds", async () => {
    vi.useFakeTimers();
    const onClearMessage = vi.fn();

    render(
      <HomeRouteView
        snapshot={snapshot([])}
        settings={defaultSettings}
        loading={false}
        message="Refresh failed."
        onClearMessage={onClearMessage}
        onRefresh={vi.fn()}
        onKillPort={vi.fn()}
        onKillAll={vi.fn()}
        onOpenPort={vi.fn()}
        onOpenSettings={vi.fn()}
        onSaveSettings={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toBeTruthy();
    expect(onClearMessage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2_999);
    expect(onClearMessage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await waitFor(() => expect(onClearMessage).toHaveBeenCalledOnce());
  });

  it("does not restart the toast timer when the view rerenders with the same message", async () => {
    vi.useFakeTimers();
    const onClearMessage = vi.fn();
    const props = {
      snapshot: snapshot([]),
      settings: defaultSettings,
      loading: false,
      message: "Refresh failed.",
      onClearMessage,
      onRefresh: vi.fn(),
      onKillPort: vi.fn(),
      onKillAll: vi.fn(),
      onOpenPort: vi.fn(),
      onOpenSettings: vi.fn(),
      onSaveSettings: vi.fn(),
    };

    const { rerender } = render(<HomeRouteView {...props} />);

    vi.advanceTimersByTime(2_000);
    rerender(<HomeRouteView {...props} snapshot={{ ...props.snapshot, scannedAtMs: 2 }} />);
    vi.advanceTimersByTime(999);
    expect(onClearMessage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await waitFor(() => expect(onClearMessage).toHaveBeenCalledOnce());
  });

  it("keeps kill all in the bottom action area on the main view", () => {
    renderHomePanel([baseEntry]);

    const button = screen.getByRole("button", { name: "Kill All Watched" });
    const footer = button.closest("footer");
    expect(footer).toBeTruthy();
    expect(footer?.className).toContain("justify-end");
    expect(button.className).not.toContain("w-full");
  });

  it("opens a port in the default browser", async () => {
    const onOpenPort = vi.fn().mockResolvedValue("http://localhost:5173");

    render(
      <HomeRouteView
        snapshot={snapshot([baseEntry])}
        settings={defaultSettings}
        loading={false}
        message={null}
        onRefresh={vi.fn()}
        onKillPort={vi.fn()}
        onKillAll={vi.fn()}
        onOpenPort={onOpenPort}
        onOpenSettings={vi.fn()}
        onSaveSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => expect(onOpenPort).toHaveBeenCalledWith(baseEntry));
    expect(screen.queryByText("Opened port 5173.")).toBeNull();
  });
});

describe("SettingsRouteView", () => {
  it("renders settings without the watched ports panel", () => {
    renderSettingsPanel();

    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.queryByLabelText("Watched ports")).toBeNull();
  });

  it("clears app messages from the settings dismiss action", () => {
    const onClearMessage = vi.fn();

    render(
      <SettingsRouteView
        settings={defaultSettings}
        message="Save failed."
        onBack={vi.fn()}
        onClearMessage={onClearMessage}
        onSaveSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));

    expect(onClearMessage).toHaveBeenCalledOnce();
  });

  it("saves the keep-open development setting when toggled", async () => {
    const onSaveSettings = vi.fn().mockImplementation(async (settings) => settings);
    const onBack = vi.fn();

    render(
      <SettingsRouteView
        settings={defaultSettings}
        message={null}
        onBack={onBack}
        onSaveSettings={onSaveSettings}
      />,
    );

    fireEvent.click(screen.getByLabelText("Keep open when unfocused"));

    await waitFor(() =>
      expect(onSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ keepOpenWhenUnfocused: true }),
      ),
    );
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save Settings" })).toBeNull();
    expect(screen.queryByText("Settings saved.")).toBeNull();
  });

  it("resets local settings drafts only when the settings revision changes", () => {
    const onSaveSettings = vi.fn().mockImplementation(async (settings) => settings);
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

    const { rerender } = render(
      <SettingsRouteView
        settings={firstSettings}
        message={null}
        onBack={vi.fn()}
        onSaveSettings={onSaveSettings}
      />,
    );

    fireEvent.input(screen.getByLabelText("Port ranges"), {
      target: { value: "draft value" },
    });
    rerender(
      <SettingsRouteView
        settings={{ ...nextSettings, lastUpdatedAt: firstSettings.lastUpdatedAt }}
        message={null}
        onBack={vi.fn()}
        onSaveSettings={onSaveSettings}
      />,
    );

    expect((screen.getByLabelText("Port ranges") as HTMLInputElement).value).toBe("draft value");

    rerender(
      <SettingsRouteView
        settings={nextSettings}
        message={null}
        onBack={vi.fn()}
        onSaveSettings={onSaveSettings}
      />,
    );

    expect((screen.getByLabelText("Port ranges") as HTMLInputElement).value).toBe(
      "4000-4002",
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
    const onSaveSettings = vi.fn().mockImplementation(async (settings) => settings);

    render(
      <SettingsRouteView
        settings={defaultSettings}
        message={null}
        onBack={vi.fn()}
        onSaveSettings={onSaveSettings}
      />,
    );

    fireEvent.input(screen.getByLabelText("Port ranges"), {
      target: { value: "4000-4002, 5173" },
    });
    fireEvent.blur(screen.getByLabelText("Port ranges"));

    await waitFor(() =>
      expect(onSaveSettings).toHaveBeenCalledWith(
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
    const onSaveSettings = vi.fn().mockImplementation(async (settings) => settings);

    render(
      <SettingsRouteView
        settings={defaultSettings}
        message={null}
        onBack={vi.fn()}
        onSaveSettings={onSaveSettings}
      />,
    );

    fireEvent.input(screen.getByLabelText("Excluded processes"), {
      target: { value: "Raycast, Google Chrome" },
    });
    fireEvent.blur(screen.getByLabelText("Excluded processes"));

    await waitFor(() =>
      expect(onSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          excludedProcessNames: ["Google Chrome", "Raycast"],
        }),
      ),
    );
  });

  it("uses the back action to leave settings", () => {
    const onBack = vi.fn();

    render(
      <SettingsRouteView
        settings={defaultSettings}
        message={null}
        onBack={onBack}
        onSaveSettings={vi.fn()}
      />,
    );

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
});
