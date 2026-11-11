import type { FlowManifest } from "../format/manifest.ts";
import { parseManifest } from "../format/parse.ts";

export const fileCheck = { type: "files", paths: ["out.txt"] };
export const step = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  do: "worker",
  instructions: "Work",
  checks: [fileCheck],
  ...extra,
});
export const userStep = (id: string) => step(id, { checks: [{ type: "user" }] });
export const askStep = (id: string, ask: Record<string, unknown> = {}) => ({
  id,
  do: "ask",
  ask: { question: "Pick", choose_from: "${['a','b']}", ...ask },
});
export const loop = (id: string, nested: unknown[], as = "job") => ({
  id,
  for_each: "${['a']}",
  as,
  steps: nested,
});
export function flow(overrides: Record<string, unknown> = {}): FlowManifest {
  const result = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "light",
    requirements: [{ id: "fs", type: "path" }],
    steps: [step("a"), userStep("b")],
    ...overrides,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.manifest;
}
export const loopFlow = ({ as, nested }: { as: string; nested: unknown[] }) =>
  flow({ steps: [loop("l", nested, as), userStep("b")] });
export const sched = (
  steps: unknown[],
  req: unknown[] = [
    { id: "mail", type: "mcp_server", tools: ["search_threads", "send_message"] },
    { id: "w", type: "web", mode: "act" },
  ],
) => flow({ steps, requirements: req, triggers: [{ kind: "schedule", every: "1h" }] });
