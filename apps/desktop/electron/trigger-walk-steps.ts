import path from "node:path";

export function triggerWalkPaths(root: string): { output: string; dataDir: string; flowDir: string } {
  const walk = path.join(root, ".workflow/scratch/plan-04/walk");
  return {
    output: path.join(walk, "pictures"),
    dataDir: path.join(walk, "app data"),
    flowDir: path.join(walk, "flow"),
  };
}

export const TRIGGER_WALK_STEPS: { name: string; hash: string; waitFor: string[]; shot: boolean }[] = [
  {
    name: "trigger-off",
    hash: "#/builder/local.claude-code-check",
    waitFor: ["Schedule", "Off"],
    shot: true,
  },
  { name: "trigger-on", hash: "#/builder/local.claude-code-check", waitFor: ["Schedule", "On"], shot: true },
  { name: "runs", hash: "#/runs", waitFor: ["Started by its schedule"], shot: true },
];

export function isTriggeredRunDone(runs: unknown): boolean {
  return (
    Array.isArray(runs) &&
    runs.some((run: unknown) => {
      if (typeof run !== "object" || run === null || !("trigger" in run) || !("state" in run)) return false;
      const trigger = run.trigger;
      return (
        typeof trigger === "object" &&
        trigger !== null &&
        "kind" in trigger &&
        trigger.kind === "schedule" &&
        (run.state === "done" || run.state === "blocked" || run.state === "failed")
      );
    })
  );
}
