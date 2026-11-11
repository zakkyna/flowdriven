import type { RateLimit } from "../harness.ts";
import { BACKOFF_MINUTES, CLAIM_MS, CORRECTION, SAMPLE_MS } from "./constants.ts";
import { admit } from "./gate.ts";
import type {
  HarnessQuota,
  Keeper,
  KeeperConfig,
  Probes,
  QuotaWindow,
  Slot,
  Ticket,
  Waiting,
} from "./types.ts";

type Windows = { fiveHour?: QuotaWindow; sevenDay?: QuotaWindow };
type Deps = {
  config: () => KeeperConfig;
  probes: Probes;
  nowMs: () => number;
  every: (ms: number, fn: () => void) => () => void;
  weeklyAnswer: (harnessId: string) => "keep" | "hold" | undefined;
  onWeekly?: (harnessId: string, window: QuotaWindow) => void;
  onChange?: () => void;
  loadQuota?: () => Record<string, Windows>;
  saveQuota?: (harnessId: string, windows: Windows) => void;
};
type Pending = {
  ticket: Ticket;
  arrival: number;
  enqueuedMs: number;
  resolve: (slot: Slot) => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
  abort: () => void;
  onWait?: () => void;
  waiting?: Waiting;
  notified: boolean;
};
type Running = { ticket: Ticket; startedMs: number; queuedMs: number; pid?: number; peakMb?: number };
export class KeeperAbortError extends Error {
  constructor() {
    super("aborted");
    this.name = "KeeperAbortError";
  }
}

function windowOf(window: QuotaWindow): QuotaWindow {
  return {
    ...(window.utilization === undefined ? {} : { utilization: window.utilization }),
    ...(window.resetsAt === undefined ? {} : { resetsAt: window.resetsAt }),
  };
}

function safely<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function createKeeper(deps: Deps): Keeper {
  const running: Running[] = [];
  const waiting: Pending[] = [];
  let quotaLoadFailed = false;
  const loaded = safely(() => deps.loadQuota?.() ?? {}, undefined);
  if (!loaded) quotaLoadFailed = true;
  const quotas = new Map<string, HarnessQuota>(Object.entries(loaded ?? {}));
  const refusals = new Map<string, number>();
  const refusalStarted = new Map<string, number>();
  const front: string[] = [];
  let arrival = 0;
  let cancel: (() => void) | undefined;
  let current: Promise<void> | undefined;
  let dirty = false;
  let stopped = false;
  const sort = () =>
    waiting.sort((a, b) => {
      const rank = (id: string) => {
        const n = front.indexOf(id);
        return n < 0 ? Number.MAX_SAFE_INTEGER : n;
      };
      return (
        rank(a.ticket.runId) - rank(b.ticket.runId) ||
        a.ticket.cls - b.ticket.cls ||
        Number(b.ticket.underWay) - Number(a.ticket.underWay) ||
        a.ticket.runStartedAt.localeCompare(b.ticket.runStartedAt) ||
        a.arrival - b.arrival
      );
    });
  const change = () => {
    safely(() => deps.onChange?.(), undefined);
  };
  const timer = () => {
    if (!stopped && (running.length || waiting.length)) {
      if (!cancel) cancel = safely(() => deps.every(SAMPLE_MS, pump), undefined);
    } else if (cancel) {
      safely(cancel, undefined);
      cancel = undefined;
    }
  };
  const setWaiting = (p: Pending, value: Waiting) => {
    if (JSON.stringify(p.waiting) !== JSON.stringify(value)) {
      p.waiting = value;
      change();
    }
    if (!p.notified) {
      p.notified = true;
      safely(() => p.onWait?.(), undefined);
    }
  };
  const forgetFront = (id: string) => {
    if (waiting.some((p) => p.ticket.runId === id) || running.some((r) => r.ticket.runId === id)) return;
    const index = front.indexOf(id);
    if (index >= 0) front.splice(index, 1);
  };
  const remove = (p: Pending) => {
    const index = waiting.indexOf(p);
    if (index >= 0) waiting.splice(index, 1);
    p.signal.removeEventListener("abort", p.abort);
  };
  const evaluate = async () => {
    try {
      let refreshFailed = false;
      try {
        await deps.probes.refresh();
      } catch {
        refreshFailed = true;
      }
      for (const row of running) {
        try {
          if (row.pid !== undefined) {
            const rss = deps.probes.groupRssMb(row.pid);
            if (rss !== undefined && Number.isFinite(rss) && rss >= 0)
              row.peakMb = Math.max(row.peakMb ?? 0, rss * CORRECTION);
          }
        } catch {
          /* A failed sample does not erase an earlier peak. */
        }
      }
      sort();
      let global: Waiting | undefined;
      for (const p of [...waiting]) {
        if (!waiting.includes(p)) continue;
        if (global) {
          setWaiting(p, global);
          continue;
        }
        try {
          const config = deps.config();
          if (
            refreshFailed ||
            quotaLoadFailed ||
            !Number.isFinite(p.ticket.weightMb) ||
            p.ticket.weightMb < 0 ||
            !Number.isInteger(config.ceiling) ||
            config.ceiling < 1 ||
            !Number.isFinite(config.reserveMb) ||
            config.reserveMb < 0 ||
            !Number.isFinite(config.fiveHourLine) ||
            !Number.isFinite(config.sevenDayLine)
          )
            throw new Error("invalid gate input");
          const now = deps.nowMs();
          if (!Number.isFinite(now)) throw new Error("invalid clock");
          const availableMb = safely(() => deps.probes.availableMb(), undefined);
          const pressure = safely(() => deps.probes.pressureLevel(), undefined);
          if (
            (availableMb !== undefined && (!Number.isFinite(availableMb) || availableMb < 0)) ||
            (pressure !== undefined && (!Number.isFinite(pressure) || pressure < 0))
          )
            throw new Error("invalid probe");
          const verdict = admit({
            ticket: p.ticket,
            running,
            claimedMb: running
              .filter((r) => now - r.startedMs < CLAIM_MS)
              .reduce((sum, r) => sum + r.ticket.weightMb, 0),
            availableMb,
            pressure,
            quota: quotas.get(p.ticket.harnessId),
            weeklyAnswer: deps.weeklyAnswer(p.ticket.harnessId),
            config,
            nowMs: now,
          });
          if (!verdict.ok) {
            setWaiting(p, verdict.waiting);
            if (verdict.waiting.reason === "memory" || verdict.waiting.reason === "ceiling")
              global = verdict.waiting;
            continue;
          }
          remove(p);
          const row: Running = {
            ticket: p.ticket,
            startedMs: now,
            queuedMs: Math.max(0, now - p.enqueuedMs),
          };
          running.push(row);
          let released = false;
          p.resolve({
            waitedMs: row.queuedMs,
            admittedMs: row.startedMs,
            attach(pid) {
              if (!released) row.pid = pid;
            },
            release() {
              if (!released) {
                released = true;
                const index = running.indexOf(row);
                if (index >= 0) running.splice(index, 1);
                forgetFront(row.ticket.runId);
                change();
                timer();
                pump();
              }
              return row.peakMb === undefined ? {} : { peakMb: row.peakMb };
            },
          });
          change();
        } catch {
          setWaiting(p, { reason: "memory" });
        }
      }
      timer();
    } catch {
      /* Leave tickets waiting on an unexpected failure. */
    }
  };
  function pump() {
    if (stopped) return;
    dirty = true;
    if (current) return;
    current = (async () => {
      while (dirty && !stopped) {
        dirty = false;
        await evaluate();
      }
    })()
      .catch(() => {})
      .finally(() => {
        current = undefined;
        if (dirty && !stopped) pump();
      });
  }
  return {
    acquire(ticket, signal, onWait) {
      if (stopped || signal.aborted) return Promise.reject(new KeeperAbortError());
      return new Promise<Slot>((resolve, reject) => {
        const p: Pending = {
          ticket,
          arrival: arrival++,
          enqueuedMs: safely(deps.nowMs, 0),
          resolve,
          reject,
          signal,
          onWait,
          notified: false,
          abort: () => {
            remove(p);
            forgetFront(p.ticket.runId);
            reject(new KeeperAbortError());
            change();
            timer();
            pump();
          },
        };
        waiting.push(p);
        signal.addEventListener("abort", p.abort, { once: true });
        timer();
        pump();
      });
    },
    noteLimits(harnessId, limits: RateLimit[]) {
      const quota = quotas.get(harnessId) ?? {};
      for (const limit of limits) {
        if (limit.windows.five_hour) quota.fiveHour = windowOf(limit.windows.five_hour);
        if (limit.windows.seven_day) quota.sevenDay = windowOf(limit.windows.seven_day);
        if (limit.type === "five_hour" && limit.utilization !== undefined)
          quota.fiveHour = {
            utilization: limit.utilization,
            ...(limit.resetsAt === undefined ? {} : { resetsAt: limit.resetsAt }),
          };
        if (limit.type === "seven_day" && limit.utilization !== undefined)
          quota.sevenDay = {
            utilization: limit.utilization,
            ...(limit.resetsAt === undefined ? {} : { resetsAt: limit.resetsAt }),
          };
        if (
          quota.sevenDay?.utilization !== undefined &&
          quota.sevenDay.utilization >= safely(() => deps.config().sevenDayLine, 0) &&
          (limit.windows.seven_day || limit.type === "seven_day")
        )
          safely(() => deps.onWeekly?.(harnessId, quota.sevenDay as QuotaWindow), undefined);
      }
      quotas.set(harnessId, quota);
      const windows: Windows = {};
      if (quota.fiveHour) windows.fiveHour = quota.fiveHour;
      if (quota.sevenDay) windows.sevenDay = quota.sevenDay;
      safely(() => deps.saveQuota?.(harnessId, windows), undefined);
      pump();
    },
    noteRefused(harnessId, untilMs) {
      const quota = quotas.get(harnessId) ?? {};
      const now = safely(deps.nowMs, Number.POSITIVE_INFINITY);
      const readable = untilMs !== undefined && Number.isFinite(untilMs) && untilMs > now;
      if (quota.rejectedUntil !== undefined && quota.rejectedUntil > now) {
        if (readable && untilMs > quota.rejectedUntil) quota.rejectedUntil = untilMs;
      } else {
        const count = refusals.get(harnessId) ?? 0;
        refusals.set(harnessId, count + 1);
        refusalStarted.set(harnessId, now);
        const minutes = BACKOFF_MINUTES.at(Math.min(count, BACKOFF_MINUTES.length - 1)) ?? 60;
        quota.rejectedUntil = readable ? untilMs : now + minutes * 60_000;
      }
      quotas.set(harnessId, quota);
      pump();
    },
    noteSuccess(harnessId, admittedMs) {
      const began = refusalStarted.get(harnessId);
      if (began !== undefined && Number.isFinite(admittedMs) && admittedMs > began) {
        refusals.delete(harnessId);
        refusalStarted.delete(harnessId);
        const quota = quotas.get(harnessId);
        if (quota) delete quota.rejectedUntil;
        pump();
      }
    },
    quotaOf(harnessId) {
      return structuredClone(quotas.get(harnessId) ?? {});
    },
    move(runId) {
      if (!waiting.some((p) => p.ticket.runId === runId)) return false;
      const index = front.indexOf(runId);
      if (index >= 0) front.splice(index, 1);
      front.unshift(runId);
      sort();
      change();
      pump();
      return true;
    },
    snapshot() {
      sort();
      const now = safely(deps.nowMs, 0);
      return {
        ceiling: safely(() => deps.config().ceiling, 1),
        rows: [
          ...running.map((r) => ({ ticket: r.ticket, state: "running" as const, queuedMs: r.queuedMs })),
          ...waiting.map((p) => ({
            ticket: p.ticket,
            state: "waiting" as const,
            ...(p.waiting ? { waiting: p.waiting } : {}),
            queuedMs: Math.max(0, now - p.enqueuedMs),
          })),
        ],
      };
    },
    waitingOf(runId) {
      return waiting
        .filter((p) => p.ticket.runId === runId && p.waiting)
        .map((p) => ({
          stepId: p.ticket.stepId,
          itemKey: p.ticket.itemKey,
          waiting: p.waiting ?? { reason: "memory" },
        }));
    },
    recheck: pump,
    async settled() {
      while (current) await current;
    },
    stop() {
      stopped = true;
      for (const p of [...waiting]) {
        remove(p);
        p.reject(new KeeperAbortError());
      }
      timer();
    },
  };
}
