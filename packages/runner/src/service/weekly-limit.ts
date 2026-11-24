import { type Approval, RunnerError } from "@flowdriven/contracts/v1";
import type { Store } from "../storage.ts";

type State = { resetsAt: number; askedAt: string; percent: number; answer?: "keep" | "hold" };
const prefix = "weekly-limit:";
const validId = (id: string) => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(id);

export function createWeekly(o: {
  store: Pick<Store, "getSetting" | "putSetting" | "deleteSetting">;
  now: () => Date;
  recheck: () => void;
}): {
  onLimit(harnessId: string, window: { utilization?: number; resetsAt?: number }): void;
  answerOf(harnessId: string): "keep" | "hold" | undefined;
  list(): Approval[];
  resolve(id: string, decision: "approve" | "reject"): Approval[];
} {
  function read(id: string): State | undefined {
    if (!validId(id)) return undefined;
    const value = o.store.getSetting(`weekly:${id}`);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const { resetsAt, askedAt, percent, answer } = value;
    if (
      typeof resetsAt !== "number" ||
      !Number.isFinite(resetsAt) ||
      !Number.isFinite(new Date(resetsAt * 1000).getTime()) ||
      typeof askedAt !== "string" ||
      !Number.isFinite(Date.parse(askedAt)) ||
      typeof percent !== "number" ||
      !Number.isInteger(percent) ||
      percent < 0 ||
      percent > 100 ||
      (answer !== undefined && answer !== "keep" && answer !== "hold")
    )
      return undefined;
    if (resetsAt * 1000 <= o.now().getTime()) {
      o.store.deleteSetting(`weekly:${id}`);
      return undefined;
    }
    return { resetsAt, askedAt, percent, ...(answer === undefined ? {} : { answer }) };
  }
  function item(id: string, state: State): Approval {
    const reset = new Date(state.resetsAt * 1000);
    const summary = `Claude Code's weekly limit is ${state.percent}% used and resets on ${reset.toLocaleDateString("en-US", { weekday: "long" })}. Keep running triggered flows?`;
    return {
      id: `${prefix}${id}`,
      kind: "weekly_limit",
      summary,
      payload: { kind: "text", text: summary },
      editable: false,
      createdAt: state.askedAt,
      expiresAt: reset.toISOString(),
      state:
        state.answer === "keep"
          ? "approved"
          : state.answer === "hold"
            ? "rejected"
            : o.now().getTime() >= reset.getTime()
              ? "expired"
              : "pending",
    };
  }
  function ids(): string[] {
    const stored = o.store.getSetting("weekly-index");
    return [
      ...new Set([
        "claude-code",
        ...(Array.isArray(stored)
          ? stored.filter((id): id is string => typeof id === "string" && validId(id))
          : []),
      ]),
    ];
  }
  return {
    onLimit(id, window) {
      if (
        !validId(id) ||
        typeof window.utilization !== "number" ||
        !Number.isFinite(window.utilization) ||
        window.utilization < 0 ||
        window.utilization > 1
      )
        return;
      const old = read(id);
      const readable =
        typeof window.resetsAt === "number" &&
        Number.isFinite(window.resetsAt) &&
        window.resetsAt * 1000 > o.now().getTime() &&
        Number.isFinite(new Date(window.resetsAt * 1000).getTime());
      if (!readable && old) return;
      const resetsAt = readable ? (window.resetsAt as number) : o.now().getTime() / 1000 + 86400;
      if (
        !Number.isFinite(resetsAt) ||
        resetsAt * 1000 <= o.now().getTime() ||
        !Number.isFinite(new Date(resetsAt * 1000).getTime())
      )
        return;
      if (read(id)?.resetsAt === resetsAt) return;
      const all = ids();
      if (!all.includes(id)) o.store.putSetting("weekly-index", [...all, id]);
      o.store.putSetting(`weekly:${id}`, {
        resetsAt,
        askedAt: o.now().toISOString(),
        percent: Math.floor(window.utilization * 100),
      });
    },
    answerOf(id) {
      const state = read(id);
      return state && o.now().getTime() < state.resetsAt * 1000 ? state.answer : undefined;
    },
    list() {
      return ids().flatMap((id) => {
        const state = read(id);
        return state ? [item(id, state)] : [];
      });
    },
    resolve(id, decision) {
      const harnessId = id.startsWith(prefix) ? id.slice(prefix.length) : "";
      const state = read(harnessId);
      if (!state) throw new RunnerError("not_found", `There is no approval ${id}.`);
      if (o.now().getTime() >= state.resetsAt * 1000 || (decision !== "approve" && decision !== "reject"))
        throw new RunnerError("invalid_input", "This weekly limit has expired or the decision is invalid.");
      const updated: State = { ...state, answer: decision === "approve" ? "keep" : "hold" };
      o.store.putSetting(`weekly:${harnessId}`, updated);
      o.recheck();
      return [item(harnessId, updated)];
    },
  };
}
