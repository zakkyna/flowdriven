import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { createEngine } from "./engine.ts";
import { createNotifier, observeStore } from "./service/notify-wiring.ts";
import type { Store } from "./storage.ts";
import { setup } from "./test-helpers/engine.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
const parsed = parseManifest({
  format: "flowdriven-flow/1.1",
  id: "local.login",
  name: "Login",
  kind: "build",
  steps: ["a", "b"].map((id) => ({
    id,
    do: "worker",
    instructions: "Work",
    checks: [{ type: "contains", pattern: "ok" }],
  })),
});
if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
for (const [id, site, cause] of [
  ["TC-ENG-02", undefined, { code: "agent_signed_out", params: { agent: "claude-code" } }],
  ["TC-ENG-04", "timesheet.example.com", { code: "site_sign_in", params: { site: "timesheet.example.com" } }],
] as const) {
  test(`${id} auth exit waits for sign-in`, async () => {
    const c = await setup(parsed.manifest, {
      steps: { a: { text: "ok" }, b: { exit: "auth", ...(site ? { site } : {}) } },
    });
    stores.push(c.store);
    const notices: unknown[] = [];
    const notifier = createNotifier({
      store: c.store,
      now: c.clock.now,
      send: (notice) => notices.push(notice),
    });
    const engine = createEngine({
      store: observeStore(c.store, notifier),
      harness: c.harness,
      now: c.clock.now,
    });
    const run = await engine.startRun(parsed.manifest.id, { project: "/tmp" });
    expect(run).toMatchObject({ state: "needs_login", cause, needsLoginSince: "2026-11-11T09:00:00.000Z" });
    expect(c.store.getStep(run.id, "a")?.state).toBe("passed");
    expect(c.store.getStep(run.id, "b")?.state).toBe("failed");
    expect(c.store.listAudit(run.id)).toContainEqual(
      expect.objectContaining({
        kind: "run_blocked",
        detail: { runId: run.id, state: "needs_login", cause },
      }),
    );
    expect(notices).toContainEqual(
      expect.objectContaining({ kind: "run_blocked", target: { screen: "run", runId: run.id } }),
    );
  });
}
