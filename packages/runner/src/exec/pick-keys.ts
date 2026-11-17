import type { FlowManifest } from "@flowdriven/sdk";
import type { Store } from "../storage.ts";

export function loopsOverChoice(manifest: FlowManifest, askId: string): string[] {
  if (!manifest.steps.some((step) => step.id === askId && "do" in step && step.do === "ask")) return [];
  return manifest.steps.flatMap((step) =>
    "for_each" in step && step.for_each === `\${steps.${askId}.outputs.choice}` ? [step.id] : [],
  );
}

export function pickKeysOf(store: Store, runId: string, askId: string): string[] | undefined {
  const approval = store
    .listApprovals({ runId, state: "approved" })
    .find((a) => a.kind === "ask" && a.stepId === askId);
  const payload = approval?.payload;
  if (
    !approval?.picks ||
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    !Array.isArray(payload.options)
  )
    return undefined;
  const picks = approval.picks;
  const keys: string[] = [];
  for (const option of payload.options) {
    if (!option || typeof option !== "object" || Array.isArray(option) || typeof option.key !== "string")
      return undefined;
    if (picks.includes(option.key)) keys.push(option.key);
  }
  return keys.length === picks.length && new Set(keys).size === keys.length ? keys : undefined;
}
