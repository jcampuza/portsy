import { Button, Panel } from "./PortsyUi";

interface PortsyStatusMessageProps {
  message: string;
  onDismiss: () => void;
}

export function PortsyStatusMessage({ message, onDismiss }: PortsyStatusMessageProps) {
  return (
    <Panel class="px-2.5 py-2 text-[13px] text-success" role="status">
      {message}
      <Button onClick={onDismiss}>
        X
      </Button>
    </Panel>
  );
}
