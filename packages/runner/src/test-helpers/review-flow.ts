import { parseManifest } from "@flowdriven/sdk";
export const makeFlow = (steps: unknown[], extra: Record<string, unknown> = {}) => {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "build",
    requirements: [{ id: "host", type: "mcp_server", tools: ["publish"] }],
    steps,
    ...extra,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.manifest;
};
