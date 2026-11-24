import { expect, test } from "vitest";
import { openSqliteStore } from "../sqlite-store.ts";
import { standingRule } from "../test-helpers/builders.ts";
import { createRuleHandlers } from "./handlers.ts";

test("TC-j24-16 TC-RUL-13 Ask me again revokes once and a revoked rule does not match", async () => {
  const store = await openSqliteStore(":memory:");
  try {
    const handlers = createRuleHandlers(store, () => new Date("2026-11-23T00:00:00Z"));
    const rule = standingRule(store);
    expect(handlers.revoke({ ruleId: rule.id })).toMatchObject({ rule: { id: rule.id }, changed: true });
    expect(store.listRules()[0]).toMatchObject({
      state: "revoked",
      revokedBy: "ask_me_again",
      revokedAt: expect.any(String),
    });
    expect(handlers.revoke({ ruleId: rule.id }).changed).toBe(false);
    expect(() => handlers.revoke({ ruleId: "missing" })).toThrow(
      expect.objectContaining({ code: "not_found" }),
    );
    expect(handlers.list({})).toEqual([]);
    expect(store.listAudit().filter((entry) => entry.kind === "rule_revoked")).toHaveLength(1);
    const { matchRule } = await import("../rules/standing.ts");
    expect(
      matchRule(store.listRules(), rule, {
        touches: [{ id: rule.touchId, effect: rule.effect, place: rule.place }],
      }),
    ).toBeUndefined();
  } finally {
    store.close();
  }
});

test("TC-RUL-14 lists active rules and filters by flow", async () => {
  const store = await openSqliteStore(":memory:");
  try {
    const handlers = createRuleHandlers(store, () => new Date());
    const first = standingRule(store);
    const second = standingRule(store, { flowId: "example.other" });
    const revoked = standingRule(store, { flowId: "example.revoked" });
    handlers.revoke({ ruleId: revoked.id });
    expect(handlers.list({})).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: first.id,
          sentence: first.sentence,
          effect: first.effect,
          place: first.place,
          createdAt: first.createdAt,
          createdBy: first.createdBy,
        }),
        expect.objectContaining({ id: second.id }),
      ]),
    );
    expect(handlers.list({})).toHaveLength(2);
    expect(handlers.list({ flowId: first.flowId })).toEqual([expect.objectContaining({ id: first.id })]);
  } finally {
    store.close();
  }
});

test("TC-RUL-24 permission changes keep rules and deleting a flow revokes them", async () => {
  const store = await openSqliteStore(":memory:");
  const { flowWithRules } = await import("../test-helpers/builders.ts");
  const { createRunnerService } = await import("./service.ts");
  const { manifest } = flowWithRules(store, []);
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  try {
    const rule = standingRule(store, { flowId: manifest.id });
    await service.call("settings.update", { patch: { agentPermission: "off" } });
    await service.call("settings.update", { patch: { agentPermission: "on" } });
    expect(store.listRules()[0]).toMatchObject({ id: rule.id, state: "active" });
    await service.call("flows.delete", { flowId: manifest.id });
    expect(store.listRules()[0]).toMatchObject({ state: "revoked", revokedBy: "flow_deleted" });
    expect(await service.call("rules.list", {})).toEqual([]);
  } finally {
    service.stop();
    store.close();
  }
});
