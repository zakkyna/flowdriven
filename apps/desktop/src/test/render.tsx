import { createFixtureRunnerClient, type FixtureRunnerClient, type Scenario } from "@flowdriven/fixtures";
import { type RenderResult, render } from "@testing-library/react";
import { App } from "../App";
import { RunnerProvider } from "../runner/runner-context";
export function renderApp(
  hash: string,
  options?: { scenario?: Scenario },
): RenderResult & { client: FixtureRunnerClient } {
  window.location.hash = hash;
  const client = createFixtureRunnerClient({ scenario: options?.scenario });
  return {
    ...render(
      <RunnerProvider client={client}>
        <App />
      </RunnerProvider>,
    ),
    client,
  };
}
export function readyState(container: HTMLElement, screenName: string): "true" | "false" | null {
  const value = container.querySelector(`[data-screen="${screenName}"]`)?.getAttribute("data-screen-ready");
  return value === "true" || value === "false" ? value : null;
}
