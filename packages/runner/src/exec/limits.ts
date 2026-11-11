import { durationMs, type FlowManifest, type LeafStep } from "@flowdriven/sdk";
export function limits(step: LeafStep, manifest: FlowManifest) {
  const cap = step.limits?.max_attempts ?? manifest.limits?.max_attempts ?? Infinity;
  const extra =
    (step.do === "worker" || step.do === "agent") && step.worker?.effort === "low" && cap >= step.retry + 3;
  const replanAt = step.retry + (extra ? 3 : 2);
  return {
    duration: durationMs(step.limits?.max_duration ?? manifest.limits?.max_duration ?? "30m"),
    attempts: Math.min(replanAt, cap),
    replanAt,
    ...(extra ? { mediumAt: step.retry + 2 } : {}),
  };
}
