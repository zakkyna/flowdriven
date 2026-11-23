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
  const transactions: RunnerTopic[][] = [];
  const notify = (topic: RunnerTopic) => {
    const pending = transactions.at(-1);
    if (pending) pending.push(topic);
    else mark(topic);
  };
  const topics: Partial<Record<keyof Store, RunnerTopic[]>> = {
    addUsage: ["runs", "settings"],
    putSetting: ["settings"],
    deleteSetting: ["settings"],
    putHarnessState: ["agents", "settings"],
    putFlow: ["flows", "skills"],
    putFlowHead: ["flows", "skills"],
    addVersion: ["flows", "skills"],
    putConfirmation: ["flows", "activity"],
    deleteConfirmation: ["flows", "activity"],
    confirmFlow: ["flows", "activity", "rules"],
    makeRule: ["rules", "flows"],
    revokeRule: ["rules", "flows"],
    putSchedule: ["flows"],
    deleteSchedule: ["flows"],
    putRemembered: ["flows"],
    deleteRemembered: ["flows"],
    deleteFlowData: ["flows"],
    claimStart: ["activity"],
    putChat: ["chats"],
    deleteChat: ["chats"],
    putMessage: ["chats"],
    putDraft: ["chats"],
    saveFlow: ["flows", "skills", "activity", "rules", "chats"],
    putQuestion: ["chats", "activity", "flows"],
    putCapabilityConsent: ["flows", "readiness"],
    deleteCapabilityConsent: ["flows", "readiness"],
    putTrigger: ["flows"],
    createRun: ["runs", "activity"],
    updateRun: ["runs", "activity"],
    upsertStep: ["runs", "activity"],
    upsertItem: ["runs", "activity"],
    createApproval: ["approvals", "runs", "activity", "chats"],
    updateApproval: ["approvals", "runs", "activity", "chats"],
  };
  return new Proxy(store, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (key === "transaction" && typeof value === "function")
        return (fn: () => unknown) => {
          const pending: RunnerTopic[] = [];
          transactions.push(pending);
          let result: unknown;
          try {
            result = Reflect.apply(value, target, [fn]);
          } catch (error) {
            transactions.pop();
            throw error;
          }
          transactions.pop();
          for (const topic of pending) notify(topic);
          return result;
        };
      if (typeof value !== "function" || typeof key !== "string" || !(key in topics)) return value;
      return (...args: unknown[]) => {
        const result: unknown = Reflect.apply(value, target, args);
        for (const topic of topics[key as keyof Store] ?? []) notify(topic);
        if (
          (key === "putSetting" || key === "deleteSetting") &&
          typeof args[0] === "string" &&
          (args[0].startsWith("weekly:") || args[0] === "spending-pause")
        ) {
          notify("approvals");
          notify("activity");
        }
        return result;
      };
    },
  });
}
