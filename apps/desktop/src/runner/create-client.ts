import type { RunnerClient } from "@flowdriven/contracts";
import { createFixtureRunnerClient, type Scenario } from "@flowdriven/fixtures";
import { languages } from "../i18n/languages";
import { runnerBridge } from "../shell";
import { IpcRunnerClient } from "./ipc-client";

export function scenarioFromSearch(search: string): Scenario {
  const value = new URLSearchParams(search).get("scenario");
  return value === "empty" ? "empty" : "story-v2";
}

export function createRunnerClient(search?: string): RunnerClient {
  const bridge = runnerBridge();
  if (bridge) return new IpcRunnerClient(bridge);
  return createFixtureRunnerClient({
    scenario: scenarioFromSearch(search ?? location.search),
    languages: languages.map((language) => language.code),
  });
}
