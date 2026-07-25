import { useLocation } from "preact-iso";
import { useApp } from "../app.provider";
import { PortsyMainView } from "../components/PortsyMainView";

export const HomeRoute = () => {
  const app = useApp();
  const location = useLocation();

  return <PortsyMainView app={app} onOpenSettings={() => location.route("/settings")} />;
};
