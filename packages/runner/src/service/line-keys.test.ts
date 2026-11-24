import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { LINE_KEYS } from "@flowdriven/contracts";
import { expect, test } from "vitest";

async function scan(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) =>
        entry.isDirectory()
          ? entry.name === "v1"
            ? []
            : scan(join(dir, entry.name))
          : entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
            ? [join(dir, entry.name)]
            : [],
      ),
    )
  ).flat();
}
test("TC-AST-36 runner Line literals are listed and never import desktop", async () => {
  for (const file of await scan("packages/runner/src")) {
    const source = await readFile(file, "utf8");
    expect(source, file).not.toMatch(/from\s+["'][^"']*apps\/desktop/);
    for (const match of source.matchAll(/\bkey:\s*["']([a-z][\w]*(?:\.[a-z][\w]*)+)["']/g))
      expect(LINE_KEYS, `${file}: ${match[1]}`).toContain(match[1]);
  }
});

test("TC-AST-36 existing decision Lines and notice frames contain only listed keys", async () => {
  const { openSqliteStore } = await import("../sqlite-store.ts");
  const { pendingDecision } = await import("../test-helpers/builders.ts");
  const { createRunnerService } = await import("./service.ts");
  const { createNoticePolicy } = await import("../notify/policy.ts");
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-21T00:00:00Z"),
  });
  try {
    const decision = pendingDecision(store, { id: "line-check", createdAt: "2026-11-21T00:00:00Z" });
    await service.call("approvals.resolve", { approvalId: decision.id, decision: "reject" });
    const lines = store.getRun(decision.runId)?.decisionLines ?? [];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(LINE_KEYS).toContain(line.key);
    const notice = createNoticePolicy({ nowMs: () => 0, language: () => "id" }).decide({
      kind: "approval_waiting",
      runId: decision.runId,
      approvalId: decision.id,
      flowName: "private flow",
    });
    expect(notice).toBeDefined();
    expect(LINE_KEYS).toContain(notice?.title.key);
    expect(LINE_KEYS).toContain(notice?.body.key);
    expect(JSON.stringify(notice)).not.toContain("private flow");
    expect(notice?.title).toEqual({ key: "notice.decisionTitle" });
    expect(notice?.body).toEqual({ key: "notice.decisionBody" });
  } finally {
    service.stop();
    store.close();
  }
});
