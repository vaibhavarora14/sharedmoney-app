import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initializeAnalytics } from "./analytics";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import App from "./App.tsx";
import "./index.css";
import { billSplitRoute } from "./billSplitApi";

// Bearer bill links and guest names must not enter marketing analytics.
if (billSplitRoute(window.location.pathname) === undefined) initializeAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);
