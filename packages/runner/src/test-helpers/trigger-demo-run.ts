import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Notice } from "@flowdriven/contracts";
import { RunSummary, TriggerStatus } from "@flowdriven/contracts/v1";
import { FlowManifest } from "@flowdriven/sdk";
import { createRunnerService, DEMO_HASH } from "../service/service.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import { FAKE_CLAUDE_PATH, makeFakeHome } from "./fake-claude-script.ts";

export async function runTriggerDemo(): Promise<string[]> {
  const dataDir = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  const home = makeFakeHome({
    plays: [
      {
        when: "Say x",
        actions: [{ do: "result", result: "x", structured: { report: "x", outputs: { draft: "x" } } }],
      },
    ],
  });
  const store = await openSqliteStore(":memory:");
  store.putSetting("agentPermission", "on");
  const notices: Notice[] = [];
  const ids = new Map<string, number>();
  let time = Date.parse("2026-11-12T00:00:00.000Z");
  let job: (() => void) | undefined;
  let signal: (() => void) | undefined;
  const service = createRunnerService({
    store,
    dataDir,
    mode: "live",
    env: { HOME: home, PATH: process.env.PATH, USER: "u" },
    claudePath: FAKE_CLAUDE_PATH,
    now: () => new Date(time),
    newId: (prefix) => {
      const n = (ids.get(prefix) ?? 0) + 1;
      ids.set(prefix, n);
      return `${prefix}-${n}`;
    },
    keeper: {
      probes: {
        refresh: async () => {},
        availableMb: () => 8000,
        pressureLevel: () => 1,
        groupRssMb: () => undefined,
        totalMb: () => 16000,
      },
      every: () => () => {},
    },
    triggers: {
      dayOf: (date) => date.toISOString().slice(0, 10),
      every: (_ms, fn) => {
        job = fn;
        return () => {
          job = undefined;
        };
      },
      watch: (_path, fn) => {
        signal = fn;
        return () => {
          signal = undefined;
        };
      },
    },
    notify: (notice) => notices.push(notice),
  });
  const begun: Promise<unknown>[] = [];
  const begin = service.engine.beginStart;
  service.engine.beginStart = (id, options) => {
    const result = begin(id, options);
    begun.push(result.settled);
    return result;
  };
  const tick = async () => {
    if (!job) throw new Error("Missing trigger job");
    job();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await Promise.all(begun.splice(0));
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
  const runs = async (flowId: string) =>
    RunSummary.array().parse(await service.call("runs.list", { flowId }));
  try {
    const inbox = join(dataDir, "project", "inbox");
    mkdirSync(inbox, { recursive: true });
    for (const [id, name, trigger, limits] of [
      ["local.hourly", "Hourly flow", { kind: "schedule", every: "1h", catch_up: "once" }, {}],
      ["local.flood", "Flood flow", { kind: "file_change", path: "inbox" }, { max_items: 1 }],
    ] as const) {
      const flow = FlowManifest.parse({
        format: "flowdriven-flow/1.1",
        id,
        name,
        kind: "build",
        triggers: [trigger],
        limits,
        steps: [
          {
            id: "a",
            do: "worker",
            instructions: "Say x",
            outputs: [{ id: "draft", type: "text" }],
            checks: [{ type: "contains", pattern: "x" }],
          },
        ],
      });
      service.engine.registerFlow(flow, DEMO_HASH, {});
    }
    await service.start().settled;
    await service.call("harnesses.setConsent", { harnessId: "claude-code", consent: "given" });
    const hourly = TriggerStatus.parse(
      await service.call("triggers.setEnabled", {
        flowId: "local.hourly",
        index: 0,
        enabled: true,
        hash: DEMO_HASH,
      }),
    );
    await service.call("triggers.setEnabled", {
      flowId: "local.flood",
      index: 0,
      enabled: true,
      hash: DEMO_HASH,
    });
    if (!hourly.nextAt) throw new Error("Missing next schedule");
    const lines = [`schedule on: every 1h, next run ${hourly.nextAt}`];
    for (let i = 0; i < 2; i++) {
      time += 3_600_000;
      await tick();
      const list = await runs("local.hourly");
      const run = list.find((item) => item.startedAt === new Date(time).toISOString());
      if (!run || run.state !== "done") throw new Error("Scheduled run did not finish");
      lines.push(
        `no window open: ${new Date(time).toISOString().slice(11, 16)} fired, ${run.id} ${run.state}`,
      );
    }
    time += 19_800_000;
    await tick();
    const allHourly = await runs("local.hourly");
    const latest = allHourly.find((item) => item.startedAt === new Date(time).toISOString());
    const row = latest && store.getRun(latest.id);
    const payload = row?.trigger?.payload;
    if (
      !latest ||
      latest.state !== "done" ||
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      typeof payload.missed !== "number"
    )
      throw new Error("Missing catch-up run");
    lines.push(
      `slept 5 hours 30 minutes: catch_up once started ${allHourly.length - 2} run for ${payload.missed} missed fires, ${latest.id} ${latest.state}`,
    );
    let filesWritten = 0;
    for (let i = 0; i < 500; i++) {
      writeFileSync(join(inbox, `${String(i).padStart(3, "0")}.txt`), "x");
      filesWritten++;
    }
    for (let i = 0; i < 500; i++) {
      if (!signal) throw new Error("Missing watcher");
      signal();
      time += 10_000;
      await tick();
    }
    const floodRuns = await runs("local.flood");
    const status = TriggerStatus.array()
      .parse(await service.call("triggers.list", { flowId: "local.flood" }))
      .at(0);
    const floodNotices = notices.filter((notice) => notice.kind === "flood_cap");
    const notice = floodNotices.at(0);
    if (!status || !notice || floodRuns.some((run) => run.state !== "done"))
      throw new Error("Flood did not finish");
    lines.push(
      `flood: ${filesWritten} file changes (max_items 1), daily cap ${status.dailyCap} -> ${floodRuns.length} runs, ${status.droppedToday} dropped, ${floodNotices.length} notification`,
    );
    lines.push(`notification: ${notice.title} - ${notice.body}`);
    return lines;
  } finally {
    service.stop();
    store.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
}
