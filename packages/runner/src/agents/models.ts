import { childEnv } from "../claude/env.ts";
import { runCapture } from "../claude/run-capture.ts";
import type { CatalogEntry } from "./catalog.ts";

export async function loadModels(
  entry: CatalogEntry,
  version: string,
  options: { env: Record<string, string | undefined>; cwd: string; timeoutMs?: number },
) {
  const compare = (a: string, b: string) => {
    const x = a.split(".").map(Number),
      y = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      const d = (x[i] ?? 0) - (y[i] ?? 0);
      if (d) return d;
    }
    return 0;
  };
  const key = Object.keys(entry.models)
    .filter((v) => compare(v, version) <= 0)
    .sort(compare)
    .at(-1);
  const catalog = (key ? entry.models[key] : undefined) ?? [];
  if (entry.modelsCommand) {
    try {
      const result = await runCapture(entry.modelsCommand.program, entry.modelsCommand.args, {
        env: childEnv(options.env),
        cwd: options.cwd,
        timeoutMs: Math.min(options.timeoutMs ?? 14000, 14000),
        maxBytes: 262144,
      });
      if (result.code === 0 && !result.timedOut && !result.truncated) {
        const ids = [
          ...new Set(result.stdout.split(/\s+/).filter((id) => /^[a-z][a-z0-9.-]{0,63}$/.test(id))),
        ];
        if (ids.length) {
          const defaultId = catalog.find((m) => m.isDefault && ids.includes(m.id))?.id ?? ids[0];
          return {
            source: "agent" as const,
            list: ids.map((id) => ({
              ...(catalog.find((m) => m.id === id) ?? { id, name: id, note: "allRound" as const }),
              isDefault: id === defaultId,
            })),
          };
        }
      }
    } catch {
      /* Fall back to the catalog. */
    }
  }
  return { source: "catalog" as const, list: catalog.map((model) => ({ ...model })) };
}
