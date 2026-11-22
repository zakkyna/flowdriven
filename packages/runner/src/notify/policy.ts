import { createHash } from "node:crypto";

export type NoticeEvent =
  | { kind: "question_waiting" | "confirm_waiting"; chatId: string; questionId: string }
  | { kind: "approval_waiting"; runId: string; approvalId: string; flowName: string }
  | { kind: "run_blocked"; runId: string; flowId: string; flowName: string }
  | { kind: "weekly_limit"; harnessId: string; percent: number; resetsAtMs: number }
  | { kind: "flood_cap"; flowId: string; flowName: string; day: string; cap: number }
  | {
      kind: "trigger_paused";
      flowId: string;
      index: number;
      flowName: string;
      pausedAt: string;
      why?: "blocked_runs" | "challenge";
    };
export type NoticeOut = {
  id: string;
  kind: NoticeEvent["kind"];
  title: { key: string };
  body: { key: string };
  language: string;
  target:
    | { screen: "run"; runId: string; approvalId?: string }
    | { screen: "chat"; chatId: string }
    | { screen: "flow"; flowId: string }
    | { screen: "activity" };
};

const RUN_THROTTLE_MS = 600_000;
const BLOCKED_FLOW_QUIET_MS = 21_600_000;
const WEEKLY_QUIET_MS = 86_400_000;
const SENT_MAX = 1000;
const validId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9:._-]{1,100}$/.test(id);
const quiet = (last: number | undefined, now: number, duration: number) =>
  last !== undefined && now - last < duration;

export function createNoticePolicy(o: { nowMs: () => number; language?: () => string }): {
  decide(event: NoticeEvent): NoticeOut | undefined;
} {
  const sent = new Set<string>();
  const runs = new Map<string, number>();
  const flows = new Map<string, number>();
  const weekly = new Map<string, number>();
  return {
    decide(event) {
      if (!event || typeof event !== "object") return undefined;
      const now = o.nowMs();
      if (!Number.isFinite(now)) return undefined;
      let notice: NoticeOut;
      switch (event.kind) {
        case "question_waiting":
        case "confirm_waiting": {
          if (!validId(event.chatId) || !validId(event.questionId)) return undefined;
          notice = {
            id: `question:${event.questionId}`,
            kind: event.kind,
            title: { key: "notice.questionTitle" },
            body: { key: "notice.questionBody" },
            language: o.language?.() ?? "en",
            target: { screen: "chat", chatId: event.chatId },
          };
          break;
        }
        case "approval_waiting": {
          if (!validId(event.runId) || !validId(event.approvalId) || typeof event.flowName !== "string")
            return undefined;
          notice = {
            id: `approval:${event.approvalId}`,
            kind: event.kind,
            title: { key: "notice.decisionTitle" },
            body: { key: "notice.decisionBody" },
            language: o.language?.() ?? "en",
            target: { screen: "run", runId: event.runId, approvalId: event.approvalId },
          };
          break;
        }
        case "run_blocked": {
          if (
            !validId(event.runId) ||
            typeof event.flowId !== "string" ||
            typeof event.flowName !== "string" ||
            quiet(runs.get(event.runId), now, RUN_THROTTLE_MS) ||
            quiet(flows.get(event.flowId), now, BLOCKED_FLOW_QUIET_MS)
          )
            return undefined;
          notice = {
            id: `blocked:${event.runId}`,
            kind: event.kind,
            title: { key: "notice.problemTitle" },
            body: { key: "notice.problemBody" },
            language: o.language?.() ?? "en",
            target: { screen: "run", runId: event.runId },
          };
          break;
        }
        case "weekly_limit": {
          if (
            typeof event.harnessId !== "string" ||
            !/^[a-z0-9-]{1,40}$/.test(event.harnessId) ||
            !Number.isFinite(event.percent) ||
            event.percent < 0 ||
            event.percent > 100 ||
            !Number.isFinite(event.resetsAtMs) ||
            !Number.isFinite(new Date(event.resetsAtMs).getTime()) ||
            quiet(weekly.get(event.harnessId), now, WEEKLY_QUIET_MS)
          )
            return undefined;
          notice = {
            id: `weekly:${event.harnessId}:${event.resetsAtMs}`,
            kind: event.kind,
            title: { key: "notice.limitTitle" },
            body: { key: "notice.limitBody" },
            language: o.language?.() ?? "en",
            target: { screen: "activity" },
          };
          break;
        }
        case "flood_cap": {
          if (
            typeof event.flowId !== "string" ||
            typeof event.flowName !== "string" ||
            typeof event.day !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(event.day) ||
            !Number.isSafeInteger(event.cap) ||
            event.cap < 1
          )
            return undefined;
          notice = {
            id: `flood:${createHash("sha256").update(event.flowId).digest("hex").slice(0, 16)}:${event.day}`,
            kind: event.kind,
            title: { key: "notice.limitTitle" },
            body: { key: "notice.limitBody" },
            language: o.language?.() ?? "en",
            target: validId(event.flowId) ? { screen: "flow", flowId: event.flowId } : { screen: "activity" },
          };
          break;
        }
        case "trigger_paused": {
          if (
            typeof event.flowId !== "string" ||
            typeof event.flowName !== "string" ||
            !Number.isSafeInteger(event.index) ||
            event.index < 0 ||
            !validId(event.pausedAt) ||
            (event.why !== undefined && event.why !== "blocked_runs" && event.why !== "challenge")
          )
            return undefined;
          notice = {
            id: `paused:${createHash("sha256").update(event.flowId).digest("hex").slice(0, 16)}:${event.index}:${event.pausedAt}`,
            kind: event.kind,
            title: { key: "notice.limitTitle" },
            body: { key: "notice.limitBody" },
            language: o.language?.() ?? "en",
            target: validId(event.flowId) ? { screen: "flow", flowId: event.flowId } : { screen: "activity" },
          };
          break;
        }
        default:
          return undefined;
      }
      if (!validId(notice.id) || sent.has(notice.id)) return undefined;
      sent.add(notice.id);
      if (sent.size > SENT_MAX) {
        const oldest = sent.values().next().value;
        if (oldest !== undefined) sent.delete(oldest);
      }
      if (event.kind === "approval_waiting" || event.kind === "run_blocked") runs.set(event.runId, now);
      if (event.kind === "run_blocked") flows.set(event.flowId, now);
      if (event.kind === "weekly_limit") weekly.set(event.harnessId, now);
      return notice;
    },
  };
}
