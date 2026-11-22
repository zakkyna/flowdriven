import { expect, test } from "vitest";
import { callGrant, digestCall } from "../connectors/grants.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import { pendingDecision } from "../test-helpers/builders.ts";
import { createDecisionHandlers } from "./handlers.ts";
import { createRunnerService } from "./service.ts";
import { createWeekly } from "./weekly-limit.ts";

test("TC-j24-11 phone cannot create a rule for any effect", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  const weekly = createWeekly({ store, now: () => new Date(), recheck: () => {} });
  const handlers = createDecisionHandlers(store, service.engine, weekly, () => {});
  try {
    for (const effect of ["change", "send", "post", "pay", "delete", "merge"] as const) {
      const row = pendingDecision(store, { id: `phone-${effect}`, createdAt: "2026-11-21T00:00:00Z" });
      store.updateApproval(row.id, {
        kind: "risky_action",
        effect,
        riskyAction: effect === "change" ? undefined : effect,
        fixedPlace: true,
        place: { kind: "account", value: "account", label: "Account" },
      });
      expect(() =>
        Reflect.apply(handlers.resolve, undefined, [
          { approvalId: row.id, decision: "always_allow" },
          { caller: "phone" },
        ]),
      ).toThrow(expect.objectContaining({ code: "not_allowed", reason: "phone_no_rules" }));
      expect(store.getApproval(row.id)?.state).toBe("pending");
      expect(store.listRules()).toHaveLength(0);
    }
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-SR1-16 TC-RUL-09 outside places and risky kinds remain pending without rules", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  try {
    for (const effect of ["send", "change"] as const) {
      const row = pendingDecision(store, { id: `outside-${effect}`, createdAt: "2026-11-21T00:00:00Z" });
      const tool = "log_entry";
      const input = { hours: 8 };
      const digest = digestCall(tool, input);
      store.updateApproval(row.id, {
        kind: "risky_action",
        effect,
        riskyAction: effect === "send" ? "send" : undefined,
        call: { tool, input },
        approves: [callGrant("timesheet", tool, digest)],
        outside: true,
        fixedPlace: false,
        place: { kind: "account", value: "outside", label: "Outside" },
      });
      await expect(
        service.call("approvals.resolve", { approvalId: row.id, decision: "always_allow" }),
      ).rejects.toMatchObject({
        code: "not_allowed",
        reason: effect === "send" ? "always_asks" : "place_not_fixed",
      });
      expect(store.getApproval(row.id)?.state).toBe("pending");
      expect(store.listRules()).toHaveLength(0);
      expect(
        store.listAudit(row.runId).filter((entry) => ["rule_created", "decision_made"].includes(entry.kind)),
      ).toEqual([]);
      const grant = {
        runId: row.runId,
        stepId: row.stepId,
        itemKey: row.itemKey,
        tool: "timesheet.log_entry",
        digest,
        kind: "approve" as const,
        createdAt: "",
      };
      expect(store.findGrant(grant)).toBeUndefined();
      await service.call("approvals.resolve", { approvalId: row.id, decision: "approve" });
      expect(store.findGrant(grant)).toMatchObject({ approvalId: row.id });
      expect(store.listRules()).toHaveLength(0);
    }
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-SR1-15 TC-SR1-45 eligibility for fixed places, risky actions and phone", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  const weekly = createWeekly({ store, now: () => new Date(), recheck: () => {} });
  const handlers = createDecisionHandlers(store, service.engine, weekly, () => {});
  try {
    for (const effect of ["change", "send", "post", "pay", "delete", "merge"] as const) {
      const row = pendingDecision(store, { id: `offer-${effect}`, createdAt: "2026-11-21T00:00:00Z" });
      store.updateApproval(row.id, {
        kind: "risky_action",
        effect,
        riskyAction: effect === "change" ? undefined : effect,
        fixedPlace: true,
        place: { kind: "account", value: "account", label: "Account" },
      });
      expect(handlers.list({ runId: row.runId }, { caller: "window" })).toEqual([
        expect.objectContaining({ fixedPlace: true, canAlwaysAllow: effect === "change" }),
      ]);
      expect(handlers.list({ runId: row.runId }, { caller: "phone" })).toEqual([
        { flowId: `local.flow-offer-${effect}`, stepId: row.stepId, state: "pending" },
      ]);
      if (effect !== "change")
        expect(() => handlers.resolve({ approvalId: row.id, decision: "always_allow" })).toThrow(
          expect.objectContaining({ reason: "always_asks" }),
        );
    }
    expect(store.listRules()).toHaveLength(0);
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-j24-11 window offers only fixed changes across the eleven held calls", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  const weekly = createWeekly({ store, now: () => new Date(), recheck: () => {} });
  const handlers = createDecisionHandlers(store, service.engine, weekly, () => {});
  const rows = [
    { effect: "change", fixed: true },
    { effect: "change", fixed: true },
    { effect: "send", fixed: true },
    { effect: "send", fixed: false },
    { effect: "send", fixed: true },
    { effect: "change", fixed: false, outside: true },
    { effect: "change", fixed: false },
    { effect: "post", fixed: true },
    { effect: "pay", fixed: true },
    { effect: "delete", fixed: true },
    { effect: "merge", fixed: true },
  ] as const;
  try {
    for (const [index, scenario] of rows.entries()) {
      const row = pendingDecision(store, { id: `window-${index}`, createdAt: "2026-11-21T00:00:00Z" });
      const effect = scenario.effect;
      store.updateApproval(row.id, {
        kind: "risky_action",
        effect,
        riskyAction: effect === "change" ? undefined : effect,
        fixedPlace: scenario.fixed,
        outside: "outside" in scenario,
        place: { kind: "account", value: `place-${index}`, label: "Place" },
      });
      const allowed = effect === "change" && scenario.fixed;
      expect(handlers.list({ runId: row.runId }, { caller: "window" })).toEqual([
        expect.objectContaining({ canAlwaysAllow: allowed, fixedPlace: scenario.fixed }),
      ]);
      if (!allowed)
        expect(() => handlers.resolve({ approvalId: row.id, decision: "always_allow" })).toThrow(
          expect.objectContaining({
            code: "not_allowed",
            reason: effect === "change" ? "place_not_fixed" : "always_asks",
          }),
        );
      expect(store.getApproval(row.id)?.state).toBe("pending");
    }
    expect(store.listRules()).toEqual([]);
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-SR1-15 outside, unfixed, nonpending and non-action decisions are never offered", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  const handlers = createDecisionHandlers(
    store,
    service.engine,
    createWeekly({ store, now: () => new Date(), recheck: () => {} }),
    () => {},
  );
  try {
    for (const [index, patch] of [
      { fixedPlace: false },
      { fixedPlace: true, outside: true },
      { fixedPlace: true, state: "approved" as const },
    ].entries()) {
      const row = pendingDecision(store, { id: `not-offered-${index}`, createdAt: "2026-11-21T00:00:00Z" });
      store.updateApproval(row.id, {
        kind: "risky_action",
        effect: "change",
        place: { kind: "folder", value: "folder", label: "Folder" },
        ...patch,
      });
      expect(handlers.list({ runId: row.runId }, { caller: "window" })).toEqual([
        expect.objectContaining({ canAlwaysAllow: false, fixedPlace: patch.fixedPlace }),
      ]);
    }
    const row = pendingDecision(store, { id: "signoff-not-offered", createdAt: "2026-11-21T00:00:00Z" });
    expect(handlers.list({ runId: row.runId }, { caller: "window" })).toEqual([
      expect.objectContaining({ canAlwaysAllow: false }),
    ]);
  } finally {
    service.stop();
    store.close();
  }
});
