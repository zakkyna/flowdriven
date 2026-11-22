import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { type RunInput, runClaude } from "../claude/run.ts";
import { createGrantBook, digestCall } from "../connectors/grants.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import {
  FAKE_CLAUDE_PATH,
  makeFakeHome,
  readFakeCalls,
  writeFakeScript,
} from "../test-helpers/fake-claude-script.ts";

test("TC-ENG-20 grant is used and audited before the hook allows the call", { timeout: 20000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "flowdriven-grant-"));
  const name = "test.send";
  const input = { text: "hello" };
  const home = makeFakeHome({
    plays: [
      {
        when: "grant test",
        actions: [
          { do: "tool", id: "a", name, input },
          { do: "tool", id: "b", name, input },
          { do: "result", result: "done" },
        ],
      },
    ],
  });
  const dbPath = join(root, "data.sqlite");
  const store = await openSqliteStore(dbPath);
  const db = new DatabaseSync(dbPath);
  const key = {
    runId: "run",
    stepId: "step",
    itemKey: "",
    tool: name,
    digest: digestCall(name, input),
    kind: "approve" as const,
    createdAt: "2026-11-22",
  };
  store.putCallGrant(key);
  const audits: string[] = [];
  let observed = false;
  let usedAt = "";
  const readUsed = () => {
    const row = db
      .prepare(
        "SELECT data FROM call_grants WHERE run_id = ? AND step_id = ? AND item_key = ? AND tool = ? AND digest = ?",
      )
      .get(key.runId, key.stepId, key.itemKey, key.tool, key.digest);
    return row ? (JSON.parse(String(row.data)) as { usedAt?: string }).usedAt : undefined;
  };
  try {
    const deps = {
      grants: createGrantBook(store),
      claudePath: FAKE_CLAUDE_PATH,
      env: { HOME: home, PATH: process.env.PATH, TMPDIR: "/tmp", LANG: "C" },
      controlRoot: join(root, "control"),
      newId: () => "cc1",
      newSessionId: () => "session",
      audit: (kind: string) => {
        audits.push(kind);
      },
      rounds: 20,
      pollMs: 10,
      graceMs: 1000,
      exitWaitMs: 10000,
      maxLineBytes: 100000,
      beforeAllow: () => {
        usedAt = readUsed() ?? "";
        observed = usedAt !== "" && audits.includes("grant_used");
      },
    };
    const request: RunInput = {
      runId: "run",
      stepId: "step",
      itemKey: "",
      attempt: 1,
      model: "sonnet",
      signal: new AbortController().signal,
      makePrompt: () => "grant test",
      makePolicy: ({ cwd }, sessionId) => ({
        tools: [name],
        folders: [],
        cwd,
        addDirs: [],
        schema: false,
        sessionId,
        runId: "run",
        stepId: "step",
        itemKey: "",
        effectCatalog: [{ tool: name, effect: "send", place: undefined }],
        touches: [
          {
            touchId: "send",
            effect: "send",
            matcher: "exact",
            fixedPlace: false,
            list: "asks_first",
            covers: [name],
          },
        ],
      }),
    };
    const outcome = await runClaude(request, deps);
    expect(outcome).toMatchObject({ kind: "hold", held: { tool: name, input, digest: key.digest } });
    expect(observed).toBe(true);
    expect(readUsed()).toBe(usedAt);
    expect(db.prepare("SELECT count(*) AS n FROM call_grants").get()?.n).toBe(1);
    expect(readFakeCalls(home)).toContainEqual(expect.objectContaining({ kind: "tool", id: "a", ran: true }));
    expect(readFakeCalls(home)).toContainEqual(
      expect.objectContaining({ kind: "tool", id: "b", ran: false }),
    );
    const changed = { text: "hello!" };
    writeFakeScript(home, {
      plays: [
        {
          when: "grant test",
          actions: [
            { do: "tool", id: "c", name, input: changed },
            { do: "result", result: "done" },
          ],
        },
      ],
    });
    const next = await runClaude({ ...request, attempt: 2 }, deps);
    expect(next).toMatchObject({
      kind: "hold",
      held: { tool: name, input: changed, digest: digestCall(name, changed) },
    });
    expect(readFakeCalls(home)).toContainEqual(
      expect.objectContaining({ kind: "tool", id: "c", ran: false }),
    );
    expect(readUsed()).toBe(usedAt);
  } finally {
    db.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
