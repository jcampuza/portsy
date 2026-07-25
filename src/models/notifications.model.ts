import { signal, type ReadonlySignal } from "@preact/signals";

type NoticeKind = "success" | "error";

export interface PortsyNotice {
  id: number;
  kind: NoticeKind;
  message: string;
}

export interface PortsyNotifications {
  current: ReadonlySignal<PortsyNotice | null>;
  success: (message: string) => void;
  error: (error: unknown) => void;
  clear: () => void;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createNotifications(): PortsyNotifications {
  const notice = signal<PortsyNotice | null>(null);
  let noticeId = 0;

  return {
    current: notice,
    success: (message) => {
      notice.value = { id: ++noticeId, kind: "success", message };
    },
    error: (error) => {
      notice.value = { id: ++noticeId, kind: "error", message: errorMessage(error) };
    },
    clear: () => {
      notice.value = null;
    },
  };
}
