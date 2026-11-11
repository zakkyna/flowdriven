import path from "node:path";
import { actionScript, type WalkAction } from "./demo-walk-steps";
export type ClaudeWalkAction = WalkAction | { kind: "clickInDialog"; name: string } | { kind: "wait" };
export type ClaudeWalkStep = {
  name: string;
  action: ClaudeWalkAction;
  waitFor: string[];
  shot: boolean;
  timeoutMs?: number;
};
export const CLAUDE_WALK_STEPS: ClaudeWalkStep[] = [
  {
    name: "harnesses",
    action: { kind: "go", hash: "#/harnesses" },
    waitFor: ["Claude Code", "Version", "Logged in", "Not given"],
    shot: true,
  },
  {
    name: "consent-dialog",
    action: { kind: "click", role: "button", name: "Give consent" },
    waitFor: ["Let FlowDriven run Claude Code?"],
    shot: true,
  },
  {
    name: "consent-given",
    action: { kind: "clickInDialog", name: "Give consent" },
    waitFor: ["Revoke consent"],
    shot: true,
  },
  {
    name: "check-flow",
    action: { kind: "go", hash: "#/builder/local.claude-code-check" },
    waitFor: ["Claude Code check", "Run now"],
    shot: true,
  },
  {
    name: "run-now",
    action: { kind: "click", role: "button", name: "Run now" },
    waitFor: ["Claude Code check"],
    shot: false,
  },
  { name: "runs", action: { kind: "go", hash: "#/runs" }, waitFor: ["Claude Code check"], shot: false },
  {
    name: "run-detail",
    action: { kind: "firstRun" },
    waitFor: ["Write the note", "Read the note", "Try a forbidden read"],
    shot: false,
    timeoutMs: 120000,
  },
  {
    name: "run-done",
    action: { kind: "wait" },
    waitFor: ["Passed", "Done", "Blocked calls", "This path is outside the folders this step declares."],
    shot: true,
    timeoutMs: 240000,
  },
];
export function claudeActionScript(action: ClaudeWalkAction): string {
  if (action.kind === "wait") return "true";
  if (action.kind === "clickInDialog")
    return `(() => { const dialog = document.querySelector('[role="dialog"]'); const name = ${JSON.stringify(action.name)}; const node = Array.from(dialog?.querySelectorAll('button, [role="button"]') ?? []).find(n => n.textContent.trim() === name); if (!node) return false; node.click(); return true; })()`;
  return actionScript(action);
}
export function walkPaths(repoRoot: string): { output: string; dataDir: string; flowDir: string } {
  const output = path.join(repoRoot, ".workflow/scratch/claude-walk");
  return {
    output,
    dataDir: path.join(output, "app data"),
    flowDir: path.join(repoRoot, "packages/runner/src/claude/check-flow"),
  };
}
