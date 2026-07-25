import { useModel, type Model } from "@preact/signals";
import { PortsyModel, type Portsy } from "./app.model";
import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect } from "preact/hooks";

const AppContext = createContext<Model<Portsy> | null>(null);

export const AppProvider = ({ children }: { children: ComponentChildren }) => {
  const value = useModel(() => new PortsyModel());

  useEffect(() => {
    void value.start();
    return () => value.stop();
  }, [value]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
};
