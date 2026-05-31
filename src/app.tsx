import { LocationProvider, Route, Router } from "preact-iso";
import { HomeRoute } from "./routes/home";
import { SettingsRoute } from "./routes/settings";

export function App() {
  return (
    <LocationProvider>
      <Router>
        <Route path="/" component={HomeRoute} />
        <Route path="/settings" component={SettingsRoute} />
      </Router>
    </LocationProvider>
  );
}
