import { isAbsolute } from "node:path";
import { RunnerError } from "@flowdriven/contracts";
import { hasErrors } from "@flowdriven/sdk";
import { FlowFileError, loadFlowFolder } from "@flowdriven/sdk/node";
import type { Engine } from "../engine.ts";
import type { Store } from "../storage.ts";
import { toFlowDetail, toFlowSummary } from "./map-flow.ts";

export function createFlowReadHandlers(store: Store, engine: Engine, now: () => Date) {
  return {
    list: () =>
      store
        .listFlows()
        .map((row) => toFlowSummary(row, store))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    get: ({ flowId }: { flowId: string }) => {
      const head = store.getFlowHead(flowId);
      if (head?.deletedAt) throw new RunnerError("not_found", "Flow not found.", { reason: "flow_deleted" });
      const row = store.getFlow(flowId);
      if (!row) throw new RunnerError("not_found", "Flow not found.");
      return toFlowDetail(row, store);
    },
    import: ({ path }: { path: string }) => {
      if (!isAbsolute(path))
        throw new RunnerError("invalid_input", "The flow folder must be an absolute path.");
      try {
        const loaded = loadFlowFolder(path);
        if (hasErrors(loaded.issues)) return { issues: loaded.issues };
        const files = Object.fromEntries(
          [...loaded.files].map(([name, bytes]) => [name, new TextDecoder().decode(bytes)]),
        );
        return store.transaction(() => {
          const row = engine.registerFlow(loaded.manifest, loaded.hash, files);
          if (!store.getFlowHead(row.id))
            store.putFlowHead({
              id: row.id,
              name: loaded.manifest.name,
              summary: loaded.manifest.summary,
              headHash: row.hash,
              createdAt: row.registeredAt,
              updatedAt: row.registeredAt,
              origin: { kind: "import" },
            });
          store.appendAudit({
            at: now().toISOString(),
            kind: "flow_imported",
            detail: { flowId: row.id, hash: row.hash },
          });
          return { flow: toFlowSummary(row, store), issues: loaded.issues, hash: loaded.hash };
        });
      } catch (error) {
        if (error instanceof FlowFileError) throw new RunnerError("invalid_input", error.message);
        if (error instanceof Error && "code" in error && error.code === "ENOENT")
          throw new RunnerError("not_found", "There is no folder at that path.");
        throw error;
      }
    },
  };
}
