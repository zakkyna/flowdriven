import {
  ActivitySummary,
  Agent,
  Approval,
  CardView,
  ChatSummary,
  ChatView,
  FlowDetail,
  FlowManifest,
  FlowSummary,
  MessageView,
  RunDetail,
  RunSummary,
  SearchResult,
  Settings,
  Skill,
  StandingRuleView,
} from "@flowdriven/contracts";
import { expect, test } from "vitest";
import { buildStoryV2, STORY_V2_NOW } from "./index.ts";

test("TC-CON-33: every chat-first sample record validates against contract 2", () => {
  const story = buildStoryV2();
  expect(STORY_V2_NOW).toBe("2026-11-20T03:00:00.000Z");
  expect(story.flows.map((flow) => flow.summary.id)).toEqual([
    "example.build-apk",
    "example.fill-timesheet",
    "example.weekly-supplier-report",
    "example.email-triage",
    "example.job-review",
  ]);
  for (const flow of story.flows) {
    FlowDetail.parse(flow);
    FlowSummary.parse(flow.summary);
    FlowManifest.parse(flow.manifest);
  }
  for (const chat of story.chats) {
    ChatView.parse(chat);
    ChatSummary.parse(chat.chat);
    for (const message of chat.messages) {
      MessageView.parse(message);
      if (message.card) CardView.parse(message.card);
    }
  }
  for (const run of story.runs) RunDetail.parse(run);
  for (const run of story.runSummaries) RunSummary.parse(run);
  for (const decision of story.decisions) Approval.parse(decision);
  for (const rule of story.rules) StandingRuleView.parse(rule);
  ActivitySummary.parse(story.activity);
  for (const agent of story.agents) Agent.parse(agent);
  Settings.parse(story.settings);
  for (const skill of story.skills) Skill.parse(skill);
  for (const result of story.searchResults) SearchResult.parse(result);
  expect(story.chats.map((chat) => chat.chat.id)).toContain("c1");
  expect(story.decisions.some((decision) => decision.state === "pending")).toBe(true);
  expect(story.runs.map((run) => run.state)).toEqual([
    "waiting_approval",
    "running",
    "done",
    "needs_login",
    "failed",
    "blocked",
    "interrupted",
    "stopped",
  ]);
  expect(buildStoryV2()).toEqual(story);
  const first = story.flows[0];
  if (!first) throw new Error("Missing sample flow");
  first.summary.name = "Changed";
  expect(buildStoryV2().flows[0]?.summary.name).not.toBe("Changed");
});
