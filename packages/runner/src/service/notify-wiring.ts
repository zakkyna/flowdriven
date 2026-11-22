import { Notice } from "@flowdriven/contracts/v1";
import { createNoticePolicy, type NoticeEvent } from "../notify/policy.ts";
import type { RunState } from "../states.ts";
import type { ApprovalRow, Store } from "../storage.ts";
import type { FloodEvent, PausedEvent } from "../triggers/service.ts";

type Weekly = { percent: number; resetsAtMs: number };
type Hooks = {
  onApproval(row: ApprovalRow): void;
  onRunState(runId: string, state: RunState): void;
  onWeekly(harnessId: string, info: Weekly): void;
};
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export function observeStore(store: Store, hooks: Hooks): Store {
  return new Proxy(store, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (
        typeof value !== "function" ||
        (key !== "createApproval" && key !== "updateRun" && key !== "putSetting")
      )
        return value;
      return (...args: unknown[]) => {
        const result: unknown = Reflect.apply(value, target, args);
        let callback: (() => void) | undefined;
        if (key === "createApproval") callback = () => hooks.onApproval(args[0] as ApprovalRow);
        if (
          key === "updateRun" &&
          typeof args[0] === "string" &&
          object(args[1]) &&
          args[1].state !== undefined
        ) {
          const id = args[0],
            state = args[1].state as RunState;
          callback = () => hooks.onRunState(id, state);
        }
        if (key === "putSetting" && typeof args[0] === "string" && object(args[1])) {
          const match = /^weekly:([a-z0-9-]{1,40})$/.exec(args[0]);
          const id = match?.[1],
            data = args[1];
          if (
            id &&
            !Object.hasOwn(data, "answer") &&
            typeof data.resetsAt === "number" &&
            Number.isFinite(data.resetsAt) &&
            typeof data.percent === "number" &&
            Number.isInteger(data.percent) &&
            data.percent >= 0 &&
            data.percent <= 100 &&
            Number.isFinite(data.resetsAt * 1000)
          ) {
            const info = { percent: data.percent, resetsAtMs: data.resetsAt * 1000 };
            callback = () => hooks.onWeekly(id, info);
          }
        }
        if (callback)
          queueMicrotask(() => {
            try {
              callback?.();
            } catch {}
          });
        return result;
      };
    },
  });
}
export function createNotifier(o: {
  store: Store;
  now: () => Date;
  send: (notice: Notice) => void;
}): Hooks & { onFlood(event: FloodEvent): void; onPaused(event: PausedEvent): void } {
  const policy = createNoticePolicy({ nowMs: () => o.now().getTime() });
  function send(event: NoticeEvent) {
    try {
      const notice = policy.decide(event);
      const parsed = Notice.safeParse(notice);
      if (parsed.success) o.send(parsed.data);
    } catch {}
  }
  function runInfo(id: string) {
    const run = o.store.getRun(id);
    if (!run) return undefined;
    const manifest = o.store.getFlow(run.flowId, run.flowHash)?.manifest;
    return {
      run,
      flowName: object(manifest) && typeof manifest.name === "string" ? manifest.name : "A flow",
    };
  }
  return {
    onApproval(row) {
      try {
        if (o.store.getApproval(row.id)?.state !== "pending") return;
        const info = runInfo(row.runId);
        if (info)
          send({ kind: "approval_waiting", runId: row.runId, approvalId: row.id, flowName: info.flowName });
      } catch {}
    },
    onRunState(id, state) {
      try {
        if (state !== "blocked" && state !== "needs_login") return;
        const info = runInfo(id);
        if (info?.run.state === state)
          send({ kind: "run_blocked", runId: id, flowId: info.run.flowId, flowName: info.flowName });
      } catch {}
    },
    onFlood(event) {
      send({ kind: "flood_cap", ...event });
    },
    onPaused(event) {
      send({ kind: "trigger_paused", ...event });
    },
    onWeekly(harnessId, info) {
      try {
        const current = o.store.getSetting(`weekly:${harnessId}`);
        if (
          object(current) &&
          !Object.hasOwn(current, "answer") &&
          typeof current.resetsAt === "number" &&
          current.resetsAt * 1000 === info.resetsAtMs
        )
          send({ kind: "weekly_limit", harnessId, ...info });
      } catch {}
    },
  };
}
