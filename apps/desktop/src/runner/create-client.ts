import type { RunnerClient } from "@flowdriven/contracts/v1";
import { createFixtureRunnerClient, type Scenario } from "@flowdriven/fixtures/v1";
import { runnerBridge } from "../shell";
import { IpcRunnerClient } from "./ipc-client";
export function scenarioFromSearch(search: string): Scenario {
  const value = new URLSearchParams(search).get("scenario");
  return value === "empty" || value === "long" || value === "looped" ? value : "story";
}
export function createRunnerClient(search?: string): RunnerClient {
  const bridge = runnerBridge();
  if (bridge) return new IpcRunnerClient(bridge);
  return createFixtureRunnerClient({ scenario: scenarioFromSearch(search ?? location.search) });
}
