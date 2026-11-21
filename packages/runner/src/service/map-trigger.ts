import { TriggerStatus } from "@flowdriven/contracts/v1";
import type { TriggerView } from "../triggers/service.ts";

export function toTriggerStatus(view: TriggerView): TriggerStatus {
  const { nextAtMs, last, ...rest } = view;
  return TriggerStatus.parse({
    ...rest,
    ...(nextAtMs === undefined ? {} : { nextAt: new Date(nextAtMs).toISOString() }),
    ...(last ? { last: { ...last, at: new Date(last.atMs).toISOString() } } : {}),
  });
}
