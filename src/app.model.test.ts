import { waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortsyModel, type PortsyModel as PortsyModelInstance } from "./app.model";
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

const activeModels: PortsyModelInstance[] = [];

function createModel() {
  const model = new PortsyModel();
  activeModels.push(model);
  return model;
}

beforeEach(() => {
  vi.clearAllMocks();
  tauri.getSettings.mockResolvedValue(loadedSettings);
  tauri.getSnapshot.mockResolvedValue(loadedSnapshot);
  tauri.onSnapshot.mockReturnValue(Promise.resolve(vi.fn()));
  tauri.startMonitor.mockResolvedValue(undefined);
});

afterEach(() => {
  activeModels.splice(0).forEach((model) => model.stop());
});

describe("PortsyModel startup", () => {
  it("loads settings and snapshot before clearing the loading state", async () => {
    const model = createModel();
    void model.start();

    await waitFor(() => expect(model.loading.value).toBe(false));

    expect(model.settings.value).toEqual(loadedSettings);
    expect(model.snapshot.value).toEqual(loadedSnapshot);
    expect(model.notifications.current.value).toBeNull();
    expect(tauri.startMonitor).toHaveBeenCalledOnce();
  });

  it("clears loading and reports the error when initial state loading fails", async () => {
    tauri.getSettings.mockRejectedValue(new Error("settings failed"));
    const model = createModel();
    void model.start();

    await waitFor(() => expect(model.loading.value).toBe(false));

    expect(model.notifications.current.value?.message).toBe("settings failed");
    expect(model.notifications.current.value?.kind).toBe("error");
    expect(model.snapshot.value).toBeNull();
    expect(tauri.startMonitor).not.toHaveBeenCalled();
  });

  it("keeps loaded state and reports the error when monitor startup fails", async () => {
    tauri.startMonitor.mockRejectedValue(new Error("monitor failed"));
    const model = createModel();
    void model.start();

    await waitFor(() => expect(model.loading.value).toBe(false));

    expect(model.settings.value).toEqual(loadedSettings);
    expect(model.snapshot.value).toEqual(loadedSnapshot);
    expect(model.notifications.current.value?.message).toBe("monitor failed");
  });

  it("clears the current message when requested", async () => {
    tauri.startMonitor.mockRejectedValue(new Error("monitor failed"));
    const model = createModel();
    void model.start();

    await waitFor(() => expect(model.notifications.current.value?.message).toBe("monitor failed"));

    model.notifications.clear();

    expect(model.notifications.current.value).toBeNull();
  });

  it("keeps the last notification while refreshing successfully", async () => {
    const nextSnapshot = {
      ...loadedSnapshot,
      scannedAtMs: 2,
    };
    const model = createModel();
    void model.start();

    await waitFor(() => expect(model.loading.value).toBe(false));

    tauri.getSnapshot.mockRejectedValueOnce(new Error("refresh failed"));
    await model.ports.refresh();
    expect(model.notifications.current.value?.message).toBe("refresh failed");

    tauri.getSnapshot.mockResolvedValueOnce(nextSnapshot);
    await model.ports.refresh();

    expect(model.notifications.current.value?.message).toBe("refresh failed");
    expect(model.snapshot.value).toEqual(nextSnapshot);
  });
});
