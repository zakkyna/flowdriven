import { FlowManifest, Requirement } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { capabilitySentence, needsAllow, routeRequirement } from "./route.ts";

test("~/job-review/work resolves under the home folder and is the files route with the granted-folder sentence", () => {
  const req = Requirement.parse({ id: "work", type: "path", ref: "~/job-review/work", access: "read_write" });
  expect(routeRequirement(req, { hooks: true, chrome: false })).toMatchObject({
    routed: true,
    provider: "claude-code-files",
    enforcedBy: "FlowDriven hook in Claude Code",
    label: "official",
    away: true,
  });
  expect(capabilitySentence(req)).toBe(
    "Reads and changes files in ~/job-review/work, a folder outside the project that you grant.",
  );
  const readOnly = Requirement.parse({ id: "work", type: "path", ref: "~/job-review/work", access: "read" });
  expect(capabilitySentence(readOnly)).toBe(
    "Reads files in ~/job-review/work, a folder outside the project that you grant.",
  );
});
test("needsAllow is true for a flow whose only requirement is a granted folder", () => {
  const manifest = FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "light",
    requirements: [{ id: "work", type: "path", ref: "~/work", access: "read" }],
    steps: [{ id: "worker", do: "worker", instructions: "Work", uses: [] }],
  });
  expect(needsAllow(manifest)).toBe(true);
});
