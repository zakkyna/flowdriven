export function shellKind(): "electron" | "browser" {
  return (window as Window & { flowdrivenShell?: { kind: string } }).flowdrivenShell?.kind === "electron"
    ? "electron"
    : "browser";
}

export type RunnerBridge = {
  call(method: string, input: unknown): Promise<unknown>;
  subscribe(listener: (event: unknown) => void): () => void;
};
export function runnerBridge(): RunnerBridge | undefined {
  const runner = (window as Window & { flowdrivenShell?: { runner?: RunnerBridge } }).flowdrivenShell?.runner;
  return runner && typeof runner.call === "function" && typeof runner.subscribe === "function"
    ? runner
    : undefined;
}
