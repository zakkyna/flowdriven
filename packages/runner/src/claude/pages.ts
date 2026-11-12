import type { Store } from "../storage.ts";
import type { BrowserState, PageCounts } from "./browser.ts";

export type PageCounter = {
  count(runId: string, requirementId: string): PageCounts;
  take(runId: string, requirementId: string): void;
};
export function createPageCounter(o: {
  store: Pick<Store, "counter" | "increment" | "getRun">;
  dayOf: (date: Date) => string;
  now: () => Date;
}): PageCounter {
  const keys = (runId: string, requirementId: string) => {
    const run: unknown = o.store.getRun(runId);
    if (
      !run ||
      typeof run !== "object" ||
      !("flowId" in run) ||
      typeof run.flowId !== "string" ||
      !run.flowId
    )
      throw new Error("Run not found.");
    return {
      run: `pages-run:${runId}:${requirementId}`,
      day: `pages:${run.flowId}:${requirementId}`,
      date: o.dayOf(o.now()),
    };
  };
  return {
    count(runId, requirementId) {
      const k = keys(runId, requirementId);
      return { run: o.store.counter(k.run, "run"), day: o.store.counter(k.day, k.date) };
    },
    take(runId, requirementId) {
      const k = keys(runId, requirementId);
      o.store.increment(k.run, "run");
      o.store.increment(k.day, k.date);
    },
  };
}
export type AttemptState = {
  state(): BrowserState;
  takePage(): void;
  openTab(): void;
  learn(ids: number[]): void;
};
export function createAttemptState(o: {
  pages: PageCounter;
  runId: string;
  requirementId: string;
}): AttemptState {
  const tabs = new Set<number>();
  let opened = 0;
  return {
    state: () => ({ counts: o.pages.count(o.runId, o.requirementId), tabs, opened }),
    takePage() {
      // Counts are read from the store on every decision.
    },
    openTab() {
      opened++;
    },
    learn(ids) {
      for (const id of ids) tabs.add(id);
    },
  };
}
