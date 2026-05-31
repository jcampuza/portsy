import { render } from "preact";
import "./index.css";
import { App } from "./app.tsx";
import { AppProvider } from "./app.provider.tsx";

render(
  <AppProvider>
    <App />
  </AppProvider>,
  document.getElementById("app")!,
);
