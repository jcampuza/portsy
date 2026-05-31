import { waitFor } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PortsyModel } from "./app.model";
import { defaultSettings, type PortSnapshot } from "./lib/types";

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

vi.mock("./lib/tauri", () => tauri);

const loadedSettings = {
  ...defaultSettings,
  lastUpdatedAt: 1,
};

const loadedSnapshot: PortSnapshot = {
  scannedAtMs: 1,
  ranges: loadedSettings.ranges,
  entries: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  tauri.getSettings.mockResolvedValue(loadedSettings);
  tauri.getSnapshot.mockResolvedValue(loadedSnapshot);
  tauri.onSnapshot.mockReturnValue(Promise.resolve(vi.fn()));
  tauri.startMonitor.mockResolvedValue(undefined);
});

describe("PortsyModel startup", () => {
  it("loads settings and snapshot before clearing the loading state", async () => {
    const model = new PortsyModel();

    await waitFor(() => expect(model.loading.value).toBe(false));

    expect(model.settings.value).toEqual(loadedSettings);
    expect(model.snapshot.value).toEqual(loadedSnapshot);
    expect(model.message.value).toBeNull();
    expect(tauri.startMonitor).toHaveBeenCalledOnce();
  });

  it("clears loading and reports the error when initial state loading fails", async () => {
    tauri.getSettings.mockRejectedValue(new Error("settings failed"));
    const model = new PortsyModel();

    await waitFor(() => expect(model.loading.value).toBe(false));

    expect(model.message.value).toBe("settings failed");
    expect(model.snapshot.value).toBeNull();
    expect(tauri.startMonitor).not.toHaveBeenCalled();
  });

  it("keeps loaded state and reports the error when monitor startup fails", async () => {
    tauri.startMonitor.mockRejectedValue(new Error("monitor failed"));
    const model = new PortsyModel();

    await waitFor(() => expect(model.loading.value).toBe(false));

    expect(model.settings.value).toEqual(loadedSettings);
    expect(model.snapshot.value).toEqual(loadedSnapshot);
    expect(model.message.value).toBe("monitor failed");
  });

  it("clears the current message when requested", async () => {
    tauri.startMonitor.mockRejectedValue(new Error("monitor failed"));
    const model = new PortsyModel();

    await waitFor(() => expect(model.message.value).toBe("monitor failed"));

    model.clearMessage();

    expect(model.message.value).toBeNull();
  });

  it("clears stale refresh errors after a successful refresh", async () => {
    const nextSnapshot = {
      ...loadedSnapshot,
      scannedAtMs: 2,
    };
    const model = new PortsyModel();

    await waitFor(() => expect(model.loading.value).toBe(false));

    tauri.getSnapshot.mockRejectedValueOnce(new Error("refresh failed"));
    await model.refresh();
    expect(model.message.value).toBe("refresh failed");

    tauri.getSnapshot.mockResolvedValueOnce(nextSnapshot);
    await model.refresh();

    expect(model.message.value).toBeNull();
    expect(model.snapshot.value).toEqual(nextSnapshot);
  });
});
