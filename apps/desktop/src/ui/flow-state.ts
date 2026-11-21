import type { FlowSummary } from "@flowdriven/contracts/v1";
import { type StatusPresentation, statusOf } from "./status";

export function flowState(flow: Pick<FlowSummary, "lastRun">): StatusPresentation {
  return flow.lastRun
    ? statusOf("run", flow.lastRun.state)
    : { icon: "dash", label: "No runs yet", tone: "neutral" };
}
