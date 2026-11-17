import { Requirement } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { capabilitySentence, DROP, routeRequirement } from "./route.ts";

const req = (ref?: string) => Requirement.parse({ id: "skill", type: "skill", ...(ref ? { ref } : {}) });
const facts = { hooks: true, chrome: false, skills: ["writer"] };

test("an installed skill that the scan lists is the FlowDriven skill route: provider flowdriven-skill, enforced by FlowDriven, official, can run while away", () => {
  expect(routeRequirement(req("claude-code:writer"), facts)).toMatchObject({
    routed: true,
    provider: "flowdriven-skill",
    enforcedBy: "FlowDriven",
    label: "official",
    away: true,
  });
});
test("an installed skill the scan does not list drops with This skill is not installed in Claude Code.", () => {
  expect(routeRequirement(req("claude-code:other"), facts)).toMatchObject({
    routed: false,
    reason: "This skill is not installed in Claude Code.",
  });
});
test("a bundled skill (flow:<name>) is routed; a skill with no ref, another ref or a bad name keeps DROP.notYet", () => {
  expect(routeRequirement(req("flow:writer"), facts)).toMatchObject({
    routed: true,
    provider: "flowdriven-skill",
  });
  for (const ref of [undefined, "other:writer", "flow:Bad_Name"])
    expect(routeRequirement(req(ref), facts)).toMatchObject({ routed: false, reason: DROP.notYet });
});
test("the sentence says Uses your Claude Code skill <name>, as it is when you allow this flow. Its text cannot add tools, sites or folders. and for a bundled skill Uses the skill <name> that comes with this flow. Its text cannot add tools, sites or folders.", () => {
  expect(capabilitySentence(req("claude-code:writer"))).toBe(
    "Uses your Claude Code skill writer, as it is when you allow this flow. Its text cannot add tools, sites or folders.",
  );
  expect(capabilitySentence(req("flow:writer"))).toBe(
    "Uses the skill writer that comes with this flow. Its text cannot add tools, sites or folders.",
  );
});
