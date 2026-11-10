import type { FlowSummary } from "@flowdriven/contracts";
import { type StatusPresentation, statusOf } from "./status";

export function flowState(flow: Pick<FlowSummary, "lastRun">): StatusPresentation {
  return flow.lastRun
    ? statusOf("run", flow.lastRun.state)
    : { icon: "dash", label: "No runs yet", tone: "neutral" };
}
