import { isAbsolute } from "node:path";
import { type FlowsConfirmInput, type FlowsConfirmOutput, RunnerError } from "@flowdriven/contracts";
import { FlowManifest } from "@flowdriven/sdk";
import type { RuleInput, Store } from "../storage.ts";
import { toFlowDetail } from "./map-flow.ts";

export function createFlowHandlers(store: Store, now: () => Date) {
  return {
    confirm(input: FlowsConfirmInput): FlowsConfirmOutput {
      const head = store.getFlowHead(input.flowId);
      const row = store.getFlow(input.flowId, input.hash);
      if (!head || head.deletedAt)
        throw new RunnerError("not_found", "Flow not found.", {
          reason: head?.deletedAt ? "flow_deleted" : undefined,
        });
      if (head.headHash !== input.hash)
        throw new RunnerError("conflict", "Flow changed.", { reason: "hash_mismatch" });
      if (!row) throw new RunnerError("not_found", "Flow version not found.");
      const manifest = FlowManifest.parse(row.manifest);
      if (manifest.inputs.some((i) => i.type === "secret_ref"))
        throw new RunnerError("not_allowed", "Keychain required.", { reason: "needs_keychain" });
      const touches = "touches" in manifest ? (manifest.touches ?? []) : [];
      if (input.onItsOwn.some((id) => !touches.some((t) => t.id === id)))
        throw new RunnerError("invalid_input", "Unknown touch.", { reason: "touch_unknown" });
      const selected = touches.filter((t) => input.onItsOwn.includes(t.id));
      if (selected.some((t) => t.rule === "not_allowed"))
        throw new RunnerError("not_allowed", "Touch is forbidden.", { reason: "never_does" });
      if (selected.some((t) => ["send", "post", "pay", "delete", "merge"].includes(t.effect)))
        throw new RunnerError("not_allowed", "Touch always asks.", { reason: "always_asks" });
      if (
        selected.some(
          (t) =>
            t.effect !== "read" &&
            (!t.place ||
              !(t.effect === "change"
                ? ["account", "folder"].includes(t.place.kind)
                : t.effect === "local_write"
                  ? t.place.kind === "folder"
                  : t.effect === "run_command" && t.place.kind === "command")),
        )
      )
        throw new RunnerError("not_allowed", "Place is not fixed.", { reason: "place_not_fixed" });
      const folders = manifest.requirements.filter((r) => r.type === "path");
      if (folders.some((r) => !input.pins?.[r.id]))
        throw new RunnerError("invalid_input", "Folder pin is missing.", { reason: "pins_missing" });
      if (Object.values(input.pins ?? {}).some((path) => !isAbsolute(path)))
        throw new RunnerError("invalid_input", "Folder pin is invalid.", { reason: "pin_invalid" });
      const at = now().toISOString();
      const ruleInputs: RuleInput[] = selected.flatMap((t) =>
        t.effect === "read" || !t.place
          ? []
          : [
              {
                flowId: input.flowId,
                touchId: t.id,
                effect: t.effect,
                place: t.place,
                sentence: t.sentence,
                createdAt: at,
                createdBy: "confirm" as const,
                confirmationHash: input.hash,
              },
            ],
      );
      return store.transaction(() => {
        const previous = store.getConfirmation(input.flowId);
        const rules = { created: [] as string[], kept: [] as string[], ended: [] as string[] };
        for (const existing of store
          .listRules()
          .filter((r) => r.flowId === input.flowId && r.state === "active")) {
          const touch = touches.find((t) => t.id === existing.touchId);
          const same =
            touch?.effect === existing.effect &&
            touch.place?.kind === existing.place.kind &&
            touch.place?.value === existing.place.value;
          if (same && input.onItsOwn.includes(existing.touchId)) rules.kept.push(existing.id);
          else {
            const by = same ? "moved_to_asks_first" : "flow_changed";
            store.revokeRule(existing.id, by);
            rules.ended.push(existing.id);
            store.appendAudit({
              at,
              kind: "rule_revoked",
              detail: {
                ruleId: existing.id,
                flowId: existing.flowId,
                touchId: existing.touchId,
                effect: existing.effect,
                placeKind: existing.place.kind,
                by,
              },
            });
          }
        }
        for (const rule of ruleInputs) {
          if (store.listRules().some((r) => rules.kept.includes(r.id) && r.touchId === rule.touchId))
            continue;
          const created = store.makeRule(rule);
          rules.created.push(created.id);
          store.appendAudit({
            at,
            kind: "rule_created",
            detail: {
              ruleId: created.id,
              flowId: created.flowId,
              touchId: created.touchId,
              effect: created.effect,
              placeKind: created.place.kind,
              by: "confirm",
            },
          });
        }
        store.putConfirmation({
          flowId: input.flowId,
          hash: input.hash,
          at,
          by: "confirm_dialog",
          onItsOwn: input.onItsOwn,
          pins: {
            skills: {},
            folders: Object.fromEntries(
              folders.map((r) => [r.id, { path: input.pins?.[r.id] ?? "", access: r.access }]),
            ),
          },
        });
        for (const q of store
          .listQuestions()
          .filter((q) => q.flowId === input.flowId && q.kind === "confirm" && q.state === "open")) {
          store.putQuestion({ ...q, state: "closed", updatedAt: at });
          const message = store.getMessage(q.messageId);
          if (message?.card?.state === "open")
            store.putMessage({
              ...message,
              card: { ...message.card, state: "answered", answer: { action: "confirm_flow", at } },
            });
        }
        store.appendAudit({
          at,
          kind: "flow_confirmed",
          detail: { flowId: input.flowId, hash: input.hash, onItsOwn: input.onItsOwn, by: "confirm_dialog" },
        });
        if (previous && previous.hash !== input.hash)
          store.appendAudit({
            at,
            kind: "flow_changed",
            detail: {
              flowId: input.flowId,
              oldHash: previous.hash,
              newHash: input.hash,
              kept: rules.kept,
              ended: rules.ended,
            },
          });
        return { flow: toFlowDetail(row, store), rules };
      });
    },
  };
}
