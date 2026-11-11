import { type FlowManifest, parseManifest } from "@flowdriven/sdk";
import type { StepResult } from "../harness.ts";

export function oneStepFlow(
  id: string,
  over: {
    retry?: number;
    effort?: "low" | "medium" | "high";
    limits?: { max_duration?: string; max_attempts?: number };
  } = {},
): FlowManifest {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id,
    name: "Test",
    kind: "build",
    steps: [
      {
        id: "a",
        do: "worker",
        instructions: "Say x",
        retry: over.retry ?? 0,
        ...(over.effort === undefined ? {} : { worker: { effort: over.effort } }),
        ...(over.limits === undefined ? {} : { limits: over.limits }),
        outputs: [{ id: "draft", type: "text" }],
        checks: [{ type: "contains", pattern: "x" }],
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.manifest;
}
export const OK: StepResult = { exit: "ok", text: "x", outputs: { draft: "x" } };
export function gate() {
  const waiting: (() => void)[] = [];
  let releases = 0;
  return {
    wait: () =>
      new Promise<void>((resolve) => {
        if (releases > 0) {
          releases--;
          resolve();
        } else waiting.push(resolve);
      }),
    release: () => {
      const resolve = waiting.shift();
      if (resolve) resolve();
      else releases++;
    },
  };
}
