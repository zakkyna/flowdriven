import type {
  Approval,
  ChatMessage,
  ContentHash,
  FlowManifest,
  FlowSignOff,
  HarnessCard,
  Playback,
  QueueView,
  ReadinessReport,
  RunDetail,
  Settings,
  UsageSummary,
} from "@flowdriven/contracts";
import { approvals } from "./story/approvals";
import { flows } from "./story/flows";
import { harnesses } from "./story/harnesses";
import { addLong } from "./story/long";
import { addLooped } from "./story/looped";
import { queue, usage } from "./story/queue";
import { readiness } from "./story/readiness";
import { runs } from "./story/runs";
import { emptySettings, settings } from "./story/settings";

export const FIXTURE_NOW = "2026-11-10T09:30:00.000Z";
export type Scenario = "story" | "empty" | "long" | "looped";
export interface FlowRecord {
  manifest: FlowManifest;
  hash: ContentHash;
  saved: boolean;
  signOff: FlowSignOff;
  playback: Playback;
  conversation: ChatMessage[];
  history: { manifest: FlowManifest; hash: ContentHash; signOff: FlowSignOff }[];
  retiredStepIds: string[];
}
export interface FixtureState {
  flows: FlowRecord[];
  runs: RunDetail[];
  approvals: Approval[];
  readiness: Record<string, ReadinessReport>;
  harnesses: HarnessCard[];
  settings: Settings;
  queue: QueueView;
  usage: UsageSummary;
  nextRunNumber: number;
  nextHashNumber: number;
}
export function buildStory(): FixtureState {
  const records = flows();
  return {
    flows: records,
    runs: runs(records),
    approvals: approvals(),
    readiness: readiness(records),
    harnesses: harnesses(),
    settings: settings(),
    queue: queue(),
    usage: usage(),
    nextRunNumber: 8,
    nextHashNumber: 6,
  };
}
export function buildEmpty(): FixtureState {
  return {
    flows: [],
    runs: [],
    approvals: [],
    readiness: {},
    harnesses: [],
    settings: emptySettings(),
    queue: { running: 0, waiting: 0, ceiling: 1, rows: [] },
    usage: { harnesses: [] },
    nextRunNumber: 1,
    nextHashNumber: 1,
  };
}
export function buildLong(): FixtureState {
  const state = buildStory();
  addLong(state);
  return state;
}

export function buildLooped(): FixtureState {
  const state = buildStory();
  addLooped(state);
  return state;
}
