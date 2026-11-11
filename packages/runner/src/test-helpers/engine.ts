import type { FlowManifest } from "@flowdriven/sdk";
import type { EngineDeps } from "../engine.ts";
import { createEngine } from "../engine.ts";
import type { Script } from "../scripted-harness.ts";
import { scriptedHarness } from "../scripted-harness.ts";
import { openSqliteStore } from "../sqlite-store.ts";

export async function setup(manifest: FlowManifest, script: Script, options: Partial<EngineDeps> = {}) {
  let time = Date.parse("2026-11-11T09:00:00.000Z");
  const clock = {
    now: () => new Date(time),
    advance: (ms: number) => {
      time += ms;
    },
  };
  const counts = new Map<string, number>();
  const newId = (prefix: string) => {
    const count = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, count);
    return `${prefix}-${count}`;
  };
  const store = await openSqliteStore(":memory:", { now: clock.now });
  const harness = scriptedHarness(script);
  const engine = createEngine({ store, harness, now: clock.now, newId, ...options });
  engine.registerFlow(manifest, `sha256:${"0".repeat(64)}`);
  return { engine, store, harness, clock };
}
