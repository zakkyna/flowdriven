import dns from "node:dns";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { expect, test, vi } from "vitest";
import { createRunnerService } from "../service/service.ts";
import { openSqliteStore } from "../sqlite-store.ts";

test("TC-j01-31 no FlowDriven network action before or after Set up", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flow-setup-"));
  const store = await openSqliteStore(":memory:");
  const fetch = vi.spyOn(globalThis, "fetch");
  const guards = [
    vi.spyOn(http, "request"),
    vi.spyOn(https, "request"),
    vi.spyOn(net, "connect"),
    vi.spyOn(tls, "connect"),
    vi.spyOn(dns, "lookup"),
  ];
  const calls: string[] = [];
  const service = createRunnerService({
    store,
    dataDir: dir,
    mode: "demo",
    env: { PATH: dir },
    agents: {
      extraDirs: [],
      spawnInstall: (program) => {
        calls.push(program);
        throw new Error("fake install");
      },
    },
  });
  try {
    await service.start().settled;
    await service.call("runner.info", {});
    await service.call("settings.get", {});
    await service.call("agents.list", {});
    await service.call("agents.rescan", {});
    expect(fetch).not.toHaveBeenCalled();
    for (const guard of guards) expect(guard).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    await service.call("agents.setUp", { agentId: "claude-code" });
    expect(fetch).not.toHaveBeenCalled();
    for (const guard of guards) expect(guard).not.toHaveBeenCalled();
    expect(calls).toEqual(["npm"]);
  } finally {
    service.stop();
    store.close();
    fetch.mockRestore();
    for (const guard of guards) guard.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});
