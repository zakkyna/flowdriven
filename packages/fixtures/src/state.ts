import type { AuditRecord } from "@flowdriven/contracts";
import { buildStoryV2, STORY_V2_NOW } from "./story-v2";

export type Scenario = "story-v2" | "empty";
export const FIXTURE_NOW = STORY_V2_NOW;
export function buildState(scenario: Scenario = "story-v2") {
  const story = buildStoryV2();
  if (scenario === "empty") {
    story.flows = [];
    story.chats = [];
    story.runs = [];
    story.runSummaries = [];
    story.decisions = [];
    story.rules = [];
  }
  return {
    ...story,
    decisions: structuredClone(story.decisions),
    rules: structuredClone(story.rules),
    audit: [] as AuditRecord[],
    counters: { chat: 0, message: 0, run: 0, start: 0, question: 0 },
    triggerSwitches: {} as Record<string, { hash: string }>,
    resumeBlockers: Object.fromEntries(
      story.runs
        .filter((run) => run.state === "blocked" || run.state === "needs_login")
        .map((run) => [run.id, true]),
    ) as Record<string, boolean>,
  };
}
export type { FixtureState, FlowRecord } from "./v1/state";
export type FixtureStateV2 = ReturnType<typeof buildState>;
