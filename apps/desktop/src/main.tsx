import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createRunnerClient } from "./runner/create-client";
import { RunnerProvider } from "./runner/runner-context";
import "./styles/tokens.css";
import "./styles/base.css";
import { applyTheme } from "./theme";

applyTheme(location.search, document.documentElement);
const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");
createRoot(root).render(
  <StrictMode>
    <RunnerProvider client={createRunnerClient(location.search)}>
      <App />
    </RunnerProvider>
  </StrictMode>,
);
