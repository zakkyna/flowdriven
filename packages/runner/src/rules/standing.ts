import type { Touch } from "@flowdriven/sdk";
import type { RuleRow } from "../storage.ts";

type Place = { kind: string; value: string; label?: string };
type Call = { flowId: string; touchId: string; effect: string; place?: Place };
type Version = { touches: { id: string; effect: string; place?: Place }[] };

function samePlace(a: Place | undefined, b: Place | undefined): boolean {
  return a !== undefined && b !== undefined && a.kind === b.kind && a.value === b.value;
}

export function matchRule(rules: RuleRow[], call: Call, runVersion: Version): RuleRow | undefined {
  if (!["local_write", "run_command", "change"].includes(call.effect)) return undefined;
  if (
    !runVersion.touches.some(
      (touch) =>
        touch.id === call.touchId && touch.effect === call.effect && samePlace(touch.place, call.place),
    )
  )
    return undefined;
  return rules.find(
    (rule) =>
      rule.state === "active" &&
      rule.flowId === call.flowId &&
      rule.touchId === call.touchId &&
      rule.effect === call.effect &&
      samePlace(rule.place, call.place),
  );
}

export function placeTouches(touches: Touch[], { origin }: { origin: "chat" | "market" }) {
  const lists: { onItsOwn: string[]; asksFirst: string[]; never: string[] } = {
    onItsOwn: [],
    asksFirst: [],
    never: [],
  };
  for (const touch of touches) {
    if (touch.rule === "not_allowed") lists.never.push(touch.id);
    else if (
      touch.effect === "read" ||
      (origin === "chat" &&
        (touch.effect === "local_write" ||
          touch.effect === "run_command" ||
          (touch.effect === "change" && touch.place !== undefined)))
    )
      lists.onItsOwn.push(touch.id);
    else lists.asksFirst.push(touch.id);
  }
  return lists;
}
