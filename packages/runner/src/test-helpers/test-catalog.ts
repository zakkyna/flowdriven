import { EFFECTS, type EffectEntry } from "../rules/effects.ts";

export const TEST_CATALOG: EffectEntry[] = [
  ...EFFECTS,
  { tool: "test.read", effect: "read", place: { kind: "account", value: "test" } },
  { tool: "test.change", effect: "change", place: { kind: "account", value: "test" } },
  { tool: "test.send", effect: "send", place: { kind: "address", fromInput: ["to", "cc", "bcc"] } },
  { tool: "test.delete", effect: "delete", place: undefined },
];
