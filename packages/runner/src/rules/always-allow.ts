import { RISKY_ACTIONS } from "@flowdriven/sdk";
import type { Effect } from "./effects.ts";
export const RISKY_KINDS = RISKY_ACTIONS;
export function canAlwaysAllow(input: {
  effect: Effect | undefined;
  place: "fixed" | "none" | "outside";
  caller: "window" | "tool" | "phone";
}): boolean {
  return input.effect === "change" && input.place === "fixed" && input.caller === "window";
}
