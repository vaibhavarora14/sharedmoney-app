import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { initializeAnalytics } from "./analytics";
import { enableSpeedInsights } from "./speedInsights";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import App from "./App.tsx";
import "./index.css";
import { billSplitRoute } from "./billSplitApi";
import { youOweRoute } from "./youOweApi";

// Bearer bill links and guest names must not enter marketing analytics.
// Speed Insights still runs there; its reporter strips the token from the URL.
if (
  billSplitRoute(window.location.pathname) === undefined
  && youOweRoute(window.location.pathname) === undefined
) initializeAnalytics();
enableSpeedInsights();

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Missing #root");
}

const app = (
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);

// The homepage document already contains the painted hero. Hydrate so React
// reuses that lead node instead of painting a new one after the bundle.
if (rootEl.dataset.hydrate === "home") {
  hydrateRoot(rootEl, app);
} else {
  createRoot(rootEl).render(app);
}
