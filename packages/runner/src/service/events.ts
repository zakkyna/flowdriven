import { RunnerTopic } from "@flowdriven/contracts";
import type { Store } from "../storage.ts";

export function createChangeEmitter(
  emit: (event: { type: "changed"; topics: RunnerTopic[] }) => void,
  schedule: (run: () => void) => void = setImmediate,
): { mark(topic: RunnerTopic): void } {
  const pending = new Set<RunnerTopic>();
  return {
    mark(topic) {
      const first = pending.size === 0;
      pending.add(topic);
      if (first)
        schedule(() => {
          const topics = RunnerTopic.options.filter((value) => pending.has(value));
          pending.clear();
          emit({ type: "changed", topics });
        });
    },
  };
}
export function wrapStore(store: Store, mark: (topic: RunnerTopic) => void): Store {
  const topics: Partial<Record<keyof Store, RunnerTopic[]>> = {
    addUsage: ["runs"],
    putSetting: ["settings"],
    deleteSetting: ["settings"],
    putHarnessState: ["harnesses", "settings"],
    putFlow: ["flows"],
    putCapabilityConsent: ["flows", "readiness"],
    deleteCapabilityConsent: ["flows", "readiness"],
    putTrigger: ["flows"],
    createRun: ["runs"],
    updateRun: ["runs"],
    upsertStep: ["runs"],
    upsertItem: ["runs"],
    createApproval: ["approvals", "runs"],
    updateApproval: ["approvals", "runs"],
  };
  return new Proxy(store, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== "function" || typeof key !== "string" || !(key in topics)) return value;
      return (...args: unknown[]) => {
        const result: unknown = Reflect.apply(value, target, args);
        for (const topic of topics[key as keyof Store] ?? []) mark(topic);
        if (
          (key === "putSetting" || key === "deleteSetting") &&
          typeof args[0] === "string" &&
          args[0].startsWith("weekly:")
        )
          mark("approvals");
        return result;
      };
    },
  });
}
