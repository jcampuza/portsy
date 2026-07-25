import { X } from "lucide-preact";
import { useEffect, useRef } from "preact/hooks";
import type { PortsyNotice } from "../app.model";
import { Panel } from "./PortsyUi";

interface PortsyStatusMessageProps {
  notice: PortsyNotice;
  onDismiss: () => void;
}

export function PortsyStatusMessage({ notice, onDismiss }: PortsyStatusMessageProps) {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const timeout = window.setTimeout(() => onDismissRef.current(), 3_000);
    return () => window.clearTimeout(timeout);
  }, [notice.id]);

  const toneClass = notice.kind === "error" ? "text-danger" : "text-success";
  const dismissToneClass =
    notice.kind === "error"
      ? "text-danger/75 hover:text-danger"
      : "text-success/75 hover:text-success";

  return (
    <Panel
      class={`fixed bottom-3 left-3 z-50 flex max-w-[min(calc(100vw-1.5rem),360px)] items-center gap-2 px-3 py-2 text-[13px] shadow-lg ${toneClass}`}
      role="status"
    >
      <span class="min-w-0 flex-1 leading-tight">{notice.message}</span>
      <button
        type="button"
        class={`flex h-5 w-5 shrink-0 items-center justify-center border-0 bg-transparent p-0 transition-colors focus-visible:outline-none ${dismissToneClass}`}
        onClick={onDismiss}
        aria-label="Dismiss notification"
        title="Dismiss"
      >
        <X aria-hidden="true" size={12} />
      </button>
    </Panel>
  );
}
