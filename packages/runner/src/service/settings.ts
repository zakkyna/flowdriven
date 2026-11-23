import { Settings, type Settings as SettingsValue } from "@flowdriven/contracts";
import type { Store } from "../storage.ts";
import { readKeeperSettings } from "./keeper-wiring.ts";

export function appLanguage(store: Store, registered: readonly string[]): string {
  const value = store.getSetting("language");
  return typeof value === "string" && registered.includes(value) ? value : "en";
}

export function readSettings(store: Store, now: Date, registered: readonly string[] = ["en"]): SettingsValue {
  const value = {
    language: appLanguage(store, registered),
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
