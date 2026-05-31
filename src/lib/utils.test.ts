import { describe, expect, it, vi } from "vitest";
import { createAsyncListenerCleanup } from "./utils";

describe("createAsyncListenerCleanup", () => {
  it("calls the listener cleanup when disposed after setup resolves", async () => {
    const listenerCleanup = vi.fn();
    const callback = vi.fn();
    let listener: (value: string) => void = () => undefined;

    const cleanup = createAsyncListenerCleanup(
      (nextListener) => {
        listener = nextListener;
        return Promise.resolve(listenerCleanup);
      },
      callback,
    );

    await Promise.resolve();
    listener("before cleanup");
    cleanup();
    listener("after cleanup");

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith("before cleanup");
    expect(listenerCleanup).toHaveBeenCalledOnce();
  });

  it("calls the listener cleanup when setup resolves after disposal", async () => {
    const listenerCleanup = vi.fn();
    let resolveCleanup: (cleanup: () => void) => void = () => undefined;

    const cleanup = createAsyncListenerCleanup(
      () =>
        new Promise((resolve) => {
          resolveCleanup = resolve;
        }),
      vi.fn(),
    );

    cleanup();
    resolveCleanup(listenerCleanup);
    await Promise.resolve();

    expect(listenerCleanup).toHaveBeenCalledOnce();
  });

  it("reports setup errors only while active", async () => {
    const onError = vi.fn();

    createAsyncListenerCleanup(
      () => Promise.reject(new Error("listen failed")),
      vi.fn(),
      onError,
    );

    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(new Error("listen failed"));
  });
});
