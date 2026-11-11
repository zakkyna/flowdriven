import { durationMs, type FlowManifest, type LeafStep } from "@flowdriven/sdk";
export function limits(step: LeafStep, manifest: FlowManifest) {
  return {
    duration: durationMs(step.limits?.max_duration ?? manifest.limits?.max_duration ?? "30m"),
    attempts: Math.min(
      step.retry + 2,
      step.limits?.max_attempts ?? manifest.limits?.max_attempts ?? Infinity,
    ),
  };
}
