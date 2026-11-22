import type { Touch } from "@flowdriven/sdk";
import { expect, test } from "vitest";

test("TC-RUL-17 places risky kinds under asks first regardless of author claim", async () => {
  const { placeTouches } = await import("./standing.ts");
  const effects: Touch["effect"][] = [
    "read",
    "local_write",
    "run_command",
    "change",
    "send",
    "post",
    "pay",
    "delete",
    "merge",
  ];
  const touches: Touch[] = effects.map((effect) => ({
    id: effect.replaceAll("_", "-"),
    sentence: effect,
    effect,
    rule: "runs_alone",
    covers: [],
    place: { kind: "account", value: "account", label: "Account" },
  }));
  touches.push({ id: "unfixed", sentence: "Unfixed", effect: "change", rule: "runs_alone", covers: [] });
  touches.push({ id: "forbidden", sentence: "Forbidden", effect: "read", rule: "not_allowed", covers: [] });
  expect(placeTouches(touches, { origin: "chat" })).toEqual({
    onItsOwn: ["read", "local-write", "run-command", "change"],
    asksFirst: ["send", "post", "pay", "delete", "merge", "unfixed"],
    never: ["forbidden"],
  });
  expect(placeTouches(touches, { origin: "market" })).toEqual({
    onItsOwn: ["read"],
    asksFirst: ["local-write", "run-command", "change", "send", "post", "pay", "delete", "merge", "unfixed"],
    never: ["forbidden"],
  });
});
