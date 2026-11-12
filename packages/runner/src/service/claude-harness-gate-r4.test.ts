import { FlowManifest } from "@flowdriven/sdk";
import { expect, test, vi } from "vitest";
import type { Routed } from "../router/types.ts";
import { gate } from "./claude-harness.ts";

vi.mock("../router/route.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../router/route.ts")>();
  return {
    ...real,
    routeAll: (requirements: { id: string; type: string }[]): Routed[] =>
      requirements.map((requirement) => ({
        routed: true,
        requirementId: requirement.id,
        type: requirement.type,
        provider: "claude-in-chrome",
        providerName: "Test",
        enforcedBy: "not enforced",
        label: "unofficial",
        away: false,
      })),
  };
});

const scan = {
  detected: true,
  path: "/bin/claude",
  version: "2.1.318",
  missingFlags: [],
  configFolder: true,
  login: "logged_in" as const,
  scannedAt: "2026-11-11T00:00:00.000Z",
  chrome: true,
};
const facts = { hooks: true, chrome: true };
const base = {
  platform: "darwin",
  dataDir: "/tmp/data",
  scan,
  finished: true,
  fileExists: () => true,
  consent: "given" as const,
  facts,
  allowed: true,
};
const worker = { id: "worker", do: "worker", instructions: "Read", uses: ["web"] };
const ask = { id: "ask", do: "ask", ask: { question: "Choose", choose_from: "items" } };
const web = {
  id: "web",
  type: "web",
  mode: "read",
  session: "own",
  url_patterns: ["https://example.com/"],
};
const manifest = (steps: unknown[], triggers: unknown[]) =>
  FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "light",
    steps,
    requirements: [web],
    triggers,
  });
const scheduled = [{ kind: "schedule", every: "1h" }];

test("gate() refuses an unattended flow whose route is not enforced", () => {
  expect(gate({ ...base, manifest: manifest([worker, ask], scheduled) })).toEqual({
    ready: false,
    reason: "This step would run unattended on a provider FlowDriven cannot enforce.",
  });
});
test("the same flow passes with a manual trigger only, and with the use after an ask", () => {
  expect(gate({ ...base, manifest: manifest([worker, ask], [{ kind: "manual" }]) })).toEqual({ ready: true });
  expect(gate({ ...base, manifest: manifest([ask, worker], scheduled) })).toEqual({ ready: true });
});
