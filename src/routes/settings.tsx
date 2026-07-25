import { useLocation } from "preact-iso";
import { useApp } from "../app.provider";
import { PortsySettingsView } from "../components/PortsySettingsView";

export const SettingsRoute = () => {
  const app = useApp();
  const location = useLocation();

  return <PortsySettingsView app={app} onBack={() => location.route("/")} />;
};
