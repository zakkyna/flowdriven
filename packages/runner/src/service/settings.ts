import { Settings, type Settings as SettingsValue } from "@flowdriven/contracts";
import type { Store } from "../storage.ts";
import { readKeeperSettings } from "./keeper-wiring.ts";

export function readSettings(store: Store, now: Date): SettingsValue {
  const value = {
    language: store.getSetting("language") ?? "en",
    agentPermission: store.getSetting("agentPermission") ?? "unset",
    mainAgent: store.getSetting("mainAgent") ?? null,
    busyFallback: store.getSetting("busyFallback") ?? false,
    spendingLimit: store.getSetting("spendingLimit") ?? 10,
  };
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return Settings.parse({
    ...value,
    spending: { month, spentUsd: 0, limitUsd: value.spendingLimit, state: "ok", allOnPlans: false },
    keeper: readKeeperSettings(store),
  });
}
