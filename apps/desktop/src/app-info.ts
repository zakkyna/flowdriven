import type { RunnerMode } from "@flowdriven/contracts";
export const APP_NAME = "FlowDriven";
export const SAMPLE_DATA_NOTE = "Sample data. Nothing here runs yet.";

export const DEMO_ENGINE_NOTE = "Demo engine. A script plays the steps.";
export function runnerNote(mode: RunnerMode): string | undefined {
  if (mode === "sample") return SAMPLE_DATA_NOTE;
  if (mode === "demo") return DEMO_ENGINE_NOTE;
  return undefined;
}
