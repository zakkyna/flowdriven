import { watch as fsWatch } from "node:fs";
import type { Engine } from "../engine.ts";
import type { Store } from "../storage.ts";
import { localDay } from "../triggers/schedule.ts";
import {
  createTriggerService,
  type FloodEvent,
  type PausedEvent,
  type TriggerDeps,
  type TriggerService,
} from "../triggers/service.ts";
import type { Every } from "./keeper-wiring.ts";
import { triggerSummary } from "./map-flow.ts";

export function wireTriggers(o: {
  store: Store;
  engine: Engine;
  now: () => Date;
  projectDir: string;
  home?: string;
  dataDir?: string;
  every?: Every;
  watch?: TriggerDeps["watch"];
  dayOf?: (date: Date) => string;
  onFlood?: (event: FloodEvent) => void;
  onPaused?: (event: PausedEvent) => void;
}): TriggerService {
  const every: Every =
    o.every ??
    ((ms, fn) => {
      const timer = setInterval(fn, ms);
      timer.unref();
      return () => clearInterval(timer);
    });
  const watch: TriggerDeps["watch"] =
    o.watch ??
    ((path, onSignal, onError) => {
      try {
        const watcher = fsWatch(path, { recursive: true, persistent: false }, () => onSignal());
        watcher.on("error", () => {
          watcher.close();
          onError();
        });
        return () => watcher.close();
      } catch {
        return undefined;
      }
    });
  return createTriggerService({
    store: o.store,
    now: o.now,
    projectDir: o.projectDir,
    home: o.home,
    dataDir: o.dataDir,
    dayOf: o.dayOf ?? localDay,
    begin: (id, options) => o.engine.beginStart(id, options),
    every,
    watch,
    summaryOf: triggerSummary,
    onFlood: o.onFlood,
    onPaused: o.onPaused,
  });
}
