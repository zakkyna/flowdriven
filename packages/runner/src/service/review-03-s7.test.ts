// Belongs in packages/runner/src/service/review-03-s7.test.ts
// S7: consent can be taken back "at any time" (CONSENT_TEXT), but setConsent refuses a revoke while Claude Code
// is not detected, so a stored "given" outlives the owner's attempt to take it back.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { CLAUDE_ID } from "./claude-harness.ts";
import { createRunnerService } from "./service.ts";

const roots: string[] = [];
const stores: Store[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
test("S7 a revoke is stored even when Claude Code is not detected", { timeout: 20_000 }, async () => {
  const dataDir = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(dataDir);
  const s = await openSqliteStore(":memory:");
  stores.push(s);
  s.putHarnessState({ id: CLAUDE_ID, consent: "given", consentAt: "2026-11-10T00:00:00.000Z" });
  let n = 0;
  const service = createRunnerService({
    store: s,
    dataDir,
    mode: "live",
    env: { HOME: dataDir, PATH: "/usr/bin:/bin", USER: "u" },
    claudePath: join(dataDir, "missing"),
    now: () => new Date("2026-11-11T00:00:00.000Z"),
    newId: (p) => `${p}-${++n}`,
  });
  await service.start().settled;
  await service.call("settings.update", { patch: { agentPermission: "on" } });
  await service.call("settings.update", { patch: { agentPermission: "off" } });
  expect(s.getSetting("agentPermission")).toBe("off");
  expect(s.getHarnessState(CLAUDE_ID)?.consent).toBe("given");
  service.stop();
});
