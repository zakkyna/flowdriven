import type { Store } from "./storage.ts";

export function flowState(store: Store, flowId: string): "new" | "confirmed" | "changed" {
  const confirmation = store.getConfirmation(flowId);
  if (!confirmation) return "new";
  return confirmation.hash === store.getFlowHead(flowId)?.headHash ? "confirmed" : "changed";
}
