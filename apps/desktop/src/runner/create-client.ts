import type { RunnerClient } from "@flowdriven/contracts";
import { createFixtureRunnerClient, type Scenario } from "@flowdriven/fixtures";
export function scenarioFromSearch(search: string): Scenario {
  const value = new URLSearchParams(search).get("scenario");
  return value === "empty" || value === "long" || value === "looped" ? value : "story";
}
export function createRunnerClient(search?: string): RunnerClient {
  return createFixtureRunnerClient({ scenario: scenarioFromSearch(search ?? location.search) });
}
