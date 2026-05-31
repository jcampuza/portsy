import { X } from "lucide-preact";
import { useEffect, useRef } from "preact/hooks";
import { Panel } from "./PortsyUi";

interface PortsyStatusMessageProps {
  message: string;
  onDismiss: () => void;
}

export function PortsyStatusMessage({ message, onDismiss }: PortsyStatusMessageProps) {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const timeout = window.setTimeout(() => onDismissRef.current(), 3_000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  return (
    <Panel
      class="fixed bottom-3 left-3 z-50 flex max-w-[min(calc(100vw-1.5rem),360px)] items-center gap-2 px-3 py-2 text-[13px] text-success shadow-lg"
      role="status"
    >
      <span class="min-w-0 flex-1 leading-tight">{message}</span>
      <button
        type="button"
        class="flex h-5 w-5 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-success/75 transition-colors hover:text-success focus-visible:outline-none"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        title="Dismiss"
      >
        <X aria-hidden="true" size={12} />
      </button>
    </Panel>
  );
}
