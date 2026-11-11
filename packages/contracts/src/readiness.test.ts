import { expect, test } from "vitest";
import { attentionCount, ENFORCEMENT, isReady, ReadinessItem, RequirementState } from "./index";

const item = (over: object) => ({
  requirementId: "r",
  name: "R",
  type: "cli_tool",
  why: "w",
  required: true,
  sensitive: false,
  state: "ok",
  route: { via: "homebrew", risk: "official" },
  autoInstall: "guided",
  guide: { steps: ["s"], commands: [], verified: true },
  checkedAt: "2026-11-10T09:30:00.000Z",
  ...over,
});

test("readiness states are ok, missing, needs_login, failed and unchecked", () => {
  expect(RequirementState.options).toEqual(["ok", "missing", "needs_login", "failed", "unchecked"]);
  expect(ENFORCEMENT).toEqual(["enforced by FlowDriven", "enforced by the harness's settings"]);
});
test("a flow is ready when every required item is ok", () => {
  const items = [item({}), item({ required: false, state: "missing" })].map((i) => ReadinessItem.parse(i));
  expect(isReady(items)).toBe(true);
  const blocked = [...items, ReadinessItem.parse(item({ state: "needs_login" }))];
  expect(isReady(blocked)).toBe(false);
  expect(attentionCount(blocked)).toBe(1);
});
test("an install command exists exactly for auto-installable items", () => {
  expect(ReadinessItem.safeParse(item({ autoInstall: "yes" })).success).toBe(false);
  expect(
    ReadinessItem.safeParse(item({ autoInstall: "yes", installCommand: "brew install ffmpeg" })).success,
  ).toBe(true);
  expect(ReadinessItem.safeParse(item({ installCommand: "brew install ffmpeg" })).success).toBe(false);
});

test("an unchecked required item needs attention", () => {
  const required = ReadinessItem.parse(item({ state: "unchecked" }));
  expect(isReady([required])).toBe(false);
  expect(attentionCount([required])).toBe(1);
  expect(isReady([{ ...required, required: false }])).toBe(true);
});
