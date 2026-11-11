import { createHash } from "node:crypto";
import { sanitizeText } from "../triggers/rules.ts";

export type NoticeEvent =
  | { kind: "approval_waiting"; runId: string; approvalId: string; flowName: string }
  | { kind: "run_blocked"; runId: string; flowId: string; flowName: string }
  | { kind: "weekly_limit"; harnessId: string; percent: number; resetsAtMs: number }
  | { kind: "flood_cap"; flowId: string; flowName: string; day: string; cap: number }
  | { kind: "trigger_paused"; flowId: string; index: number; flowName: string; pausedAt: string };
export type NoticeTarget =
  | { screen: "inbox"; approvalId?: string }
  | { screen: "run"; runId: string }
  | { screen: "builder"; flowId: string };
export type NoticeOut = {
  id: string;
  kind: NoticeEvent["kind"];
  title: string;
  body: string;
  target: NoticeTarget;
};

const RUN_THROTTLE_MS = 600_000;
const BLOCKED_FLOW_QUIET_MS = 21_600_000;
const WEEKLY_QUIET_MS = 86_400_000;
const NAME_MAX = 60;
const SENT_MAX = 1000;
const validId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9:._-]{1,100}$/.test(id);
const quiet = (last: number | undefined, now: number, duration: number) =>
  last !== undefined && now - last < duration;

export function createNoticePolicy(o: { nowMs: () => number }): {
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
        case "approval_waiting": {
          if (!validId(event.runId) || !validId(event.approvalId) || typeof event.flowName !== "string")
            return undefined;
          const name = sanitizeText(event.flowName, NAME_MAX) || "A flow";
          notice = {
            id: `approval:${event.approvalId}`,
            kind: event.kind,
            title: "Waiting for you",
            body: `${name}: an approval is waiting.`,
            target: { screen: "inbox", approvalId: event.approvalId },
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
          const name = sanitizeText(event.flowName, NAME_MAX) || "A flow";
          notice = {
            id: `blocked:${event.runId}`,
            kind: event.kind,
            title: "Run blocked",
            body: `${name} is blocked and needs a look.`,
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
          const who = event.harnessId === "claude-code" ? "Claude Code" : "A harness";
          const weekday = new Date(event.resetsAtMs).toLocaleDateString("en-US", { weekday: "long" });
          notice = {
            id: `weekly:${event.harnessId}:${event.resetsAtMs}`,
            kind: event.kind,
            title: `${who}'s weekly limit`,
            body: `${who}'s weekly limit is ${event.percent}% used and resets on ${weekday}. Keep running triggered flows?`,
            target: { screen: "inbox", approvalId: `weekly-limit:${event.harnessId}` },
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
          const name = sanitizeText(event.flowName, NAME_MAX) || "A flow";
          notice = {
            id: `flood:${createHash("sha256").update(event.flowId).digest("hex").slice(0, 16)}:${event.day}`,
            kind: event.kind,
            title: "Too many runs",
            body: `${name} reached its limit of ${event.cap} runs today. More fires are dropped until tomorrow.`,
            target: validId(event.flowId) ? { screen: "builder", flowId: event.flowId } : { screen: "inbox" },
          };
          break;
        }
        case "trigger_paused": {
          if (
            typeof event.flowId !== "string" ||
            typeof event.flowName !== "string" ||
            !Number.isSafeInteger(event.index) ||
            event.index < 0 ||
            !validId(event.pausedAt)
          )
            return undefined;
          const name = sanitizeText(event.flowName, NAME_MAX) || "A flow";
          notice = {
            id: `paused:${createHash("sha256").update(event.flowId).digest("hex").slice(0, 16)}:${event.index}:${event.pausedAt}`,
            kind: event.kind,
            title: "Trigger paused",
            body: `${name} was switched off after 3 blocked runs in a row.`,
            target: validId(event.flowId) ? { screen: "builder", flowId: event.flowId } : { screen: "inbox" },
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
