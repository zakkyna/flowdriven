import { createFixtureRunnerClient, type Scenario } from "@flowdriven/fixtures/v1";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RunnerProvider } from "./legacy/runner-context";
import "./styles/tokens.css";
import "./styles/base.css";
import { applyTheme } from "./theme";

function legacyScenarioFromSearch(search: string): Scenario {
  const value = new URLSearchParams(search).get("scenario");
  return value === "empty" || value === "long" || value === "looped" ? value : "story";
}

applyTheme(location.search, document.documentElement);
const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");
createRoot(root).render(
  <StrictMode>
    <RunnerProvider
      client={createFixtureRunnerClient({ scenario: legacyScenarioFromSearch(location.search) })}
    >
      <App />
    </RunnerProvider>
  </StrictMode>,
);
