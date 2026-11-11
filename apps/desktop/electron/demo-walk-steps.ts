export type WalkAction =
  | { kind: "go"; hash: string }
  | { kind: "click"; role: "button" | "link"; name: string }
  | { kind: "pick"; label: string }
  | { kind: "firstRun" };
export type WalkStep = { name: string; action: WalkAction; waitFor: string[]; shot: boolean };

export function waitForLoad(
  contents: { once(event: string, listener: (...args: unknown[]) => void): unknown },
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The page did not load in time.")), timeoutMs);
    contents.once("did-finish-load", () => {
      clearTimeout(timer);
      resolve();
    });
    contents.once("did-fail-load", (...args) => {
      clearTimeout(timer);
      reject(
        new Error(`The page failed to load: ${typeof args[2] === "string" ? args[2] : "unknown error"}`),
      );
    });
  });
}

export const WALK_STEPS: WalkStep[] = [
  {
    name: "sidebar",
    action: { kind: "go", hash: "#/builder/local.sample-job-review" },
    waitFor: ["Sample job review", "Demo engine. A script plays the steps.", "Run now"],
    shot: true,
  },
  {
    name: "run-waiting",
    action: { kind: "click", role: "button", name: "Run now" },
    waitFor: ["Waiting for you"],
    shot: true,
  },
  {
    name: "choice",
    action: { kind: "go", hash: "#/inbox" },
    waitFor: ["Which jobs get a prototype?", "Send choice", "Job one"],
    shot: true,
  },
  { name: "pick-one", action: { kind: "pick", label: "Job one" }, waitFor: ["Job one"], shot: false },
  {
    name: "send-choice",
    action: { kind: "click", role: "button", name: "Send choice" },
    waitFor: ["Choice sent."],
    shot: false,
  },
  {
    name: "show-waiting",
    action: { kind: "click", role: "button", name: "Waiting" },
    waitFor: ["Approve the result of"],
    shot: false,
  },
  {
    name: "sign-off",
    action: { kind: "click", role: "button", name: 'Approve the result of "proposal"' },
    waitFor: ["Approve the result of", "Approve"],
    shot: true,
  },
  {
    name: "approved",
    action: { kind: "click", role: "button", name: "Approve" },
    waitFor: ["Approved."],
    shot: true,
  },
  {
    name: "runs",
    action: { kind: "go", hash: "#/runs" },
    waitFor: ["Sample job review", "Done"],
    shot: false,
  },
  {
    name: "run-done",
    action: { kind: "firstRun" },
    waitFor: ["Show full report", "Job one", "Passed"],
    shot: true,
  },
  {
    name: "full-report",
    action: { kind: "click", role: "button", name: "Show full report" },
    waitFor: ["# Sample job review: run", "Items: 5 processed, 0 skipped as seen, 0 failed."],
    shot: true,
  },
  {
    name: "second-run",
    action: { kind: "go", hash: "#/builder/local.sample-job-review" },
    waitFor: ["Run now"],
    shot: false,
  },
  {
    name: "second-waiting",
    action: { kind: "click", role: "button", name: "Run now" },
    waitFor: ["Waiting for you"],
    shot: false,
  },
  {
    name: "second-choice",
    action: { kind: "go", hash: "#/inbox" },
    waitFor: ["Job five", "Send choice"],
    shot: true,
  },
  { name: "second-pick", action: { kind: "pick", label: "Job five" }, waitFor: ["Job five"], shot: false },
  {
    name: "second-send",
    action: { kind: "click", role: "button", name: "Send choice" },
    waitFor: ["Choice sent."],
    shot: false,
  },
  {
    name: "second-waiting-tab",
    action: { kind: "click", role: "button", name: "Waiting" },
    waitFor: ["Approve the result of"],
    shot: false,
  },
  {
    name: "second-sign-off",
    action: { kind: "click", role: "button", name: 'Approve the result of "proposal"' },
    waitFor: ["Approve"],
    shot: false,
  },
  {
    name: "second-approved",
    action: { kind: "click", role: "button", name: "Approve" },
    waitFor: ["Approved."],
    shot: false,
  },
  { name: "second-runs", action: { kind: "go", hash: "#/runs" }, waitFor: ["Done"], shot: false },
  {
    name: "second-report",
    action: { kind: "firstRun" },
    waitFor: ["Show full report", "Seen in an earlier run"],
    shot: true,
  },
  {
    name: "second-full",
    action: { kind: "click", role: "button", name: "Show full report" },
    waitFor: ["Items: 2 processed, 2 skipped as seen, 0 failed."],
    shot: true,
  },
];

export function actionScript(action: WalkAction): string {
  switch (action.kind) {
    case "go":
      return `(() => { location.hash = ${JSON.stringify(action.hash)}; return true; })()`;
    case "click": {
      const selector = action.role === "button" ? 'button, [role="button"]' : "a";
      return `(() => { const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const name = ${JSON.stringify(action.name)}; const node = nodes.find(n => n.textContent.trim() === name) ?? nodes.find(n => n.textContent.trim().includes(name)); if (!node) return false; node.click(); return true; })()`;
    }
    case "pick":
      return `(() => { const label = Array.from(document.querySelectorAll('label')).find(n => n.textContent.includes(${JSON.stringify(action.label)})); const box = label?.querySelector('input[type="checkbox"]'); if (!box) return false; box.click(); return true; })()`;
    case "firstRun":
      return `(() => { const node = Array.from(document.querySelectorAll('table a')).find(n => n.textContent.trim().startsWith('run-')); if (!node) return false; node.click(); return true; })()`;
    default:
      throw new Error("Invalid walk action");
  }
}
export function pageHasAll(body: string, texts: string[]): boolean {
  return texts.every((text) => body.includes(text));
}
export function stepFileName(index: number, name: string): string {
  return `${String(index + 1).padStart(2, "0")}-${name}.png`;
}
export function formatStepFailure(step: string, url: string, body: string): string {
  return `walk step ${step} failed; URL: ${url}; body: ${body.slice(0, 300).replace(/[\r\n]/g, " ")}`;
}
