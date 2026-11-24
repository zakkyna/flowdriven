import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { parseManifest } from "@flowdriven/sdk";
import { contentHash, parseFlowYaml } from "@flowdriven/sdk/node";
import { EngineError } from "./errors.ts";
import { newFlowId } from "./flow-id.ts";
import { type MigrationOptions, migrate } from "./migrate.ts";
import type {
  ApprovalRow,
  AuditEntry,
  CallGrant,
  ChatRow,
  Confirmation,
  ConsentPins,
  DraftRow,
  FlowHead,
  FlowRow,
  ItemRow,
  MessageRow,
  RememberedAnswer,
  RetentionRow,
  RuleRow,
  RunRow,
  ScheduleRow,
  StartRow,
  StepRow,
  Store,
  StoredAgentRow,
  TriggerRow,
  UsageEventRow,
  WaitingQuestion,
} from "./storage.ts";

export async function openSqliteStore(
  path: string,
  options?: MigrationOptions & { exclusive?: boolean; afterWrite?: (table: string) => void },
): Promise<Store> {
  const { DatabaseSync } = await import("node:sqlite");
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path);
  } catch (error) {
    if (options?.exclusive && path !== ":memory:")
      throw new EngineError(
        "unavailable",
        error instanceof Error && /locked|busy/i.test(error.message)
          ? "Another FlowDriven runner is using this data folder."
          : "The data folder could not be opened.",
      );
    throw error;
  }
  try {
    if (options?.exclusive && path !== ":memory:") {
      try {
        db.exec("PRAGMA busy_timeout = 250; PRAGMA locking_mode = EXCLUSIVE; BEGIN IMMEDIATE; COMMIT;");
      } catch (error) {
        throw new EngineError(
          "unavailable",
          error instanceof Error && /locked|busy/i.test(error.message)
            ? "Another FlowDriven runner is using this data folder."
            : "The data folder could not be opened.",
          error instanceof Error && /locked|busy/i.test(error.message) ? "data_folder_locked" : undefined,
        );
      }
    }
    db.exec("PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON; PRAGMA busy_timeout = 5000;");
    migrate(db, path, options);
    if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
    db.prepare("PRAGMA optimize").all();
  } catch (error) {
    db.close();
    throw error;
  }
  const get = (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).get(...args);
  const all = (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).all(...args);
  const execute = (sql: string, ...args: SQLInputValue[]) => {
    const result = db.prepare(sql).run(...args);
    const table = /^(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(\w+)/i.exec(sql)?.[1];
    if (depth > 0 && result.changes && table) options?.afterWrite?.(table);
    return result;
  };
  const decode = <T>(row: Record<string, unknown> | undefined): T | undefined =>
    row ? (JSON.parse(String(row.data)) as T) : undefined;
  const decodeAll = <T>(rows: Record<string, unknown>[]): T[] =>
    rows.map((row) => JSON.parse(String(row.data)) as T);
  const decodeTrigger = (record: Record<string, unknown> | undefined): TriggerRow | undefined => {
    if (!record) return undefined;
    try {
      const value: unknown = JSON.parse(String(record.data));
      if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
      const r = value as Record<string, unknown>;
      if (
        typeof r.flowId !== "string" ||
        r.flowId !== record.flow_id ||
        typeof r.index !== "number" ||
        !Number.isSafeInteger(r.index) ||
        r.index < 0 ||
        r.index !== record.idx ||
        typeof r.enabled !== "boolean" ||
        typeof r.hash !== "string" ||
        typeof r.spec !== "string" ||
        typeof r.enabledAt !== "string" ||
        (r.cursorMs !== undefined && (typeof r.cursorMs !== "number" || !Number.isFinite(r.cursorMs))) ||
        (r.recentRuns !== undefined &&
          (!Array.isArray(r.recentRuns) ||
            r.recentRuns.length > 3 ||
            !r.recentRuns.every((v: unknown) => typeof v === "string"))) ||
        (r.pausedAt !== undefined &&
          (typeof r.pausedAt !== "string" || !Number.isFinite(Date.parse(r.pausedAt))))
      )
        return undefined;
      if (r.lastFire !== undefined) {
        if (!r.lastFire || typeof r.lastFire !== "object" || Array.isArray(r.lastFire)) return undefined;
        const f = r.lastFire as Record<string, unknown>;
        if (
          typeof f.at !== "string" ||
          typeof f.outcome !== "string" ||
          ![
            "started",
            "skipped_overlap",
            "dropped_cap",
            "dropped_queue_full",
            "duplicate",
            "needs_ok",
            "refused",
            "missed",
            "depth",
            "error",
          ].includes(f.outcome) ||
          (f.runId !== undefined && typeof f.runId !== "string") ||
          (f.detail !== undefined && typeof f.detail !== "string")
        )
          return undefined;
      }
      return r as TriggerRow;
    } catch {
      return undefined;
    }
  };
  const json = (value: unknown): string => {
    const result = JSON.stringify(value);
    if (result === undefined) throw new EngineError("invalid_input", "Value is not JSON serializable.");
    return result;
  };
  const decodeRun = (row: Record<string, unknown> | undefined): RunRow | undefined => {
    const run = decode<RunRow>(row);
    if (!run) return undefined;
    const flow = decode<FlowRow>(
      get("SELECT data FROM flows WHERE id = ? AND hash = ?", run.flowId, run.flowHash),
    );
    const manifest = flow?.manifest;
    const name =
      manifest && typeof manifest === "object" && "name" in manifest && typeof manifest.name === "string"
        ? manifest.name
        : run.flowId;
    return {
      ...run,
      agent: run.agent ?? { agent: "claude-code", choice: "main" },
      language: run.language ?? "en",
      flowName: run.flowName ?? name,
      start: run.start ?? {
        source:
          !run.trigger || run.trigger.kind === "manual"
            ? "flows"
            : run.trigger.kind === "flow_done"
              ? "after"
              : "schedule",
      },
      decisionLines: run.decisionLines ?? [],
      ...(run.cause
        ? {}
        : run.state === "interrupted"
          ? { cause: { code: "crash" as const } }
          : run.blockedReason
            ? { cause: { code: "step_failed" as const } }
            : {}),
    };
  };
  let depth = 0;
  const questions = () =>
    all("SELECT id, flow_id, chat_id, kind, state, data FROM waiting_questions ORDER BY rowid").map((row) => {
      try {
        const value = JSON.parse(String(row.data)) as WaitingQuestion;
        return value &&
          typeof value === "object" &&
          value.id === row.id &&
          value.flowId === row.flow_id &&
          value.chatId === row.chat_id &&
          value.kind === row.kind &&
          value.state === row.state &&
          ["inputs", "confirm"].includes(value.kind) &&
          ["open", "answered", "cancelled", "closed"].includes(value.state) &&
          typeof value.messageId === "string" &&
          typeof value.createdAt === "string" &&
          typeof value.updatedAt === "string" &&
          typeof value.source === "string" &&
          typeof value.proactive === "boolean" &&
          typeof value.flowHash === "string" &&
          value.given !== null &&
          typeof value.given === "object" &&
          Array.isArray(value.missing) &&
          value.missing.every((item) => typeof item === "string") &&
          value.pendingStart !== null &&
          typeof value.pendingStart === "object" &&
          typeof value.pendingStart.startId === "string"
          ? value
          : undefined;
      } catch {
        return undefined;
      }
    });
  const store: Store = {
    putRemembered(row) {
      execute(
        "INSERT INTO remembered VALUES (?, ?, ?, ?) ON CONFLICT(flow_id, kind, input_id) DO UPDATE SET data = excluded.data",
        row.flowId,
        row.kind,
        row.inputId,
        json(row),
      );
    },
    listRemembered(flowId) {
      return decodeAll<RememberedAnswer>(
        all("SELECT data FROM remembered WHERE flow_id = ? ORDER BY kind, input_id", flowId),
      );
    },
    deleteRemembered(flowId, kind, inputId) {
      execute(
        "DELETE FROM remembered WHERE flow_id = ? AND kind = ? AND input_id = ?",
        flowId,
        kind,
        inputId,
      );
    },
    deleteFlowData(flowId) {
      execute("DELETE FROM remembered WHERE flow_id = ?", flowId);
    },
    listQuestions: () => questions().filter((row): row is WaitingQuestion => row !== undefined),
    putQuestion(row) {
      execute(
        "INSERT INTO waiting_questions VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET flow_id = excluded.flow_id, chat_id = excluded.chat_id, kind = excluded.kind, state = excluded.state, data = excluded.data",
        row.id,
        row.flowId,
        row.chatId,
        row.kind,
        row.state,
        json(row),
      );
    },
    claimStart(row) {
      const result = execute(
        "INSERT OR IGNORE INTO starts VALUES (?, ?, ?, ?, ?, ?, ?)",
        row.id,
        row.flowId,
        row.at,
        row.source,
        row.outcome,
        row.key ?? null,
        json(row),
      );
      if (Number(result.changes) === 1) return { created: true, row };
      const existing =
        row.key === undefined
          ? undefined
          : decode<StartRow>(
              get("SELECT data FROM starts WHERE flow_id = ? AND key = ?", row.flowId, row.key),
            );
      if (!existing) throw new EngineError("invalid_input", "Start id already exists.");
      return { created: false, row: existing };
    },
    listStarts: () => decodeAll<StartRow>(all("SELECT data FROM starts ORDER BY rowid")),
    makeRule(input) {
      const kinds: Record<string, string[]> = {
        change: ["account", "folder"],
        local_write: ["folder"],
        run_command: ["command"],
      };
      const allowed = Object.hasOwn(kinds, input.effect) ? kinds[input.effect] : undefined;
      if (!allowed) throw new Error("rule_effect_not_allowed");
      if (!allowed.includes(input.place.kind)) throw new Error("rule_place_not_allowed");
      const existing = store
        .listRules()
        .find(
          (row) =>
            row.state === "active" &&
            row.flowId === input.flowId &&
            row.touchId === input.touchId &&
            row.effect === input.effect &&
            row.place.kind === input.place.kind &&
            row.place.value === input.place.value,
        );
      if (existing) return existing;
      const row: RuleRow = {
        ...input,
        id: `rule-${randomUUID()}`,
        state: "active",
        createdAt: input.createdAt ?? new Date().toISOString(),
        createdBy: input.createdBy ?? "confirm",
        sentence: input.sentence ?? "",
        uses: 0,
      };
      execute("INSERT INTO standing_rules VALUES (?, ?, ?, ?)", row.id, row.flowId, row.state, json(row));
      return row;
    },
    listRules: () => decodeAll<RuleRow>(all("SELECT data FROM standing_rules ORDER BY rowid")),
    revokeRule(id, by) {
      const row = store.listRules().find((rule) => rule.id === id);
      if (!row) throw new EngineError("not_found", "Rule not found.");
      const next = { ...row, state: "revoked", revokedAt: new Date().toISOString(), revokedBy: by };
      execute("UPDATE standing_rules SET state = ?, data = ? WHERE id = ?", next.state, json(next), id);
    },
    useRule(id, at) {
      const row = store.listRules().find((rule) => rule.id === id && rule.state === "active");
      if (!row) throw new EngineError("not_found", "Rule not found.");
      const next = { ...row, uses: row.uses + 1, lastUsedAt: at };
      execute("UPDATE standing_rules SET data = ? WHERE id = ?", json(next), id);
    },
    putCallGrant(row) {
      const previous = decode<CallGrant>(
        get(
          "SELECT data FROM call_grants WHERE run_id = ? AND step_id = ? AND item_key = ? AND tool = ? AND digest = ?",
          row.runId,
          row.stepId,
          row.itemKey,
          row.tool,
          row.digest,
        ),
      );
      const approval = row.approvalId ? store.getApproval(row.approvalId) : undefined;
      if (
        previous?.usedAt &&
        approval &&
        previous.approvalId !== approval.id &&
        approval.state === "approved" &&
        (approval.kind === "risky_action" || approval.kind === "outside_flow") &&
        approval.runId === row.runId &&
        approval.stepId === row.stepId &&
        approval.itemKey === row.itemKey &&
        approval.approves.some(
          (entry) => entry === `${row.tool}#${row.digest}` || entry.endsWith(`.${row.tool}#${row.digest}`),
        )
      ) {
        execute(
          "UPDATE call_grants SET data = ? WHERE run_id = ? AND step_id = ? AND item_key = ? AND tool = ? AND digest = ?",
          json(row),
          row.runId,
          row.stepId,
          row.itemKey,
          row.tool,
          row.digest,
        );
        return;
      }
      execute(
        "INSERT OR IGNORE INTO call_grants VALUES (?, ?, ?, ?, ?, ?)",
        row.runId,
        row.stepId,
        row.itemKey,
        row.tool,
        row.digest,
        json(row),
      );
    },
    hasCallGrant(runId, stepId, itemKey) {
      return !!get(
        "SELECT 1 FROM call_grants WHERE run_id = ? AND (step_id = ? OR step_id = '*') AND item_key = ? LIMIT 1",
        runId,
        stepId,
        itemKey,
      );
    },
    findGrant(key) {
      const row = decode<CallGrant>(
        get(
          "SELECT data FROM call_grants WHERE run_id = ? AND step_id = ? AND item_key = ? AND tool = ? AND digest = ?",
          key.runId,
          key.stepId,
          key.itemKey,
          key.tool,
          key.digest,
        ),
      );
      return row && row.kind !== "pick" && !row.usedAt ? row : undefined;
    },
    findPickGrant(key) {
      const row = decode<CallGrant>(
        get(
          "SELECT data FROM call_grants WHERE run_id = ? AND (step_id = ? OR step_id = '*') AND item_key = ? AND tool = ? AND digest = '*'",
          key.runId,
          key.stepId,
          key.itemKey,
          key.tool,
        ),
      );
      return row?.kind === "pick" ? row : undefined;
    },
    useGrant(key, at) {
      const row = store.findGrant(key);
      if (!row) throw new EngineError("not_found", "Grant not found.");
      execute(
        "UPDATE call_grants SET data = ? WHERE run_id = ? AND step_id = ? AND item_key = ? AND tool = ? AND digest = ?",
        json({ ...row, usedAt: at }),
        key.runId,
        key.stepId,
        key.itemKey,
        key.tool,
        key.digest,
      );
    },
    skippedRows: () => {
      const approvals = all("SELECT data FROM approvals").filter((row) => {
        try {
          JSON.parse(String(row.data));
          return false;
        } catch {
          return true;
        }
      }).length;
      const skippedQuestions = questions().filter((row) => row === undefined).length;
      return {
        ...(approvals ? { approvals } : {}),
        ...(skippedQuestions ? { waiting_questions: skippedQuestions } : {}),
      };
    },
    getFlowHead: (id) => decode<FlowHead>(get("SELECT data FROM flow_heads WHERE id = ?", id)),
    listFlowHeads: () =>
      decodeAll<FlowHead>(all("SELECT data FROM flow_heads WHERE deleted_at IS NULL ORDER BY rowid")),
    putFlowHead(row) {
      execute(
        "INSERT INTO flow_heads (id, name, summary, deleted_at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, summary = excluded.summary, deleted_at = excluded.deleted_at, data = excluded.data",
        row.id,
        row.name,
        row.summary,
        row.deletedAt ?? null,
        json(row),
      );
    },
    hasFlowId(id) {
      return !!get(
        "SELECT 1 FROM flow_heads WHERE id = ? UNION ALL SELECT 1 FROM flows WHERE id = ? LIMIT 1",
        id,
        id,
      );
    },
    deleteChat(id, at = new Date().toISOString()) {
      const deleted = store.transaction(() => {
        if (!get("SELECT 1 FROM chats WHERE id = ?", id)) return false;
        const messages = Number(get("SELECT count(*) AS n FROM messages WHERE chat_id = ?", id)?.n ?? 0);
        const openQuestions = store
          .listQuestions()
          .filter((question) => question.chatId === id && question.state === "open");
        execute("DELETE FROM messages WHERE chat_id = ?", id);
        execute("DELETE FROM drafts WHERE chat_id = ?", id);
        execute("DELETE FROM waiting_questions WHERE chat_id = ?", id);
        execute("DELETE FROM chats WHERE id = ?", id);
        for (const question of openQuestions) {
          store.appendAudit({
            at,
            kind: "question_closed",
            detail: {
              questionId: question.id,
              flowId: question.flowId,
              chatId: id,
              kind: question.kind,
              state: "closed",
              why: "chat_deleted",
            },
          });
        }
        store.appendAudit({ at, kind: "chat_deleted", detail: { chatId: id, messages } });
        return true;
      });
      if (deleted && path !== ":memory:" && depth === 0) {
        try {
          db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").all();
        } catch {}
      }
      return deleted;
    },
    putChat(row) {
      execute(
        "INSERT INTO chats VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at, data = excluded.data",
        row.id,
        row.title,
        row.updatedAt,
        json(row),
      );
    },
    getChat(id) {
      return decode<ChatRow>(get("SELECT data FROM chats WHERE id = ?", id));
    },
    listChats() {
      return decodeAll<ChatRow>(all("SELECT data FROM chats ORDER BY updated_at DESC, id"));
    },
    setComposer(chatId, text) {
      const chat = store.getChat(chatId);
      if (!chat) throw new EngineError("not_found", "Chat not found.");
      if (text.length > 16000) throw new EngineError("invalid_input", "Composer text is too long.");
      store.putChat({ ...chat, composerText: text });
    },
    putMessage(row) {
      execute(
        "INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET chat_id = excluded.chat_id, seq = excluded.seq, at = excluded.at, kind = excluded.kind, card_type = excluded.card_type, card_state = excluded.card_state, search_text = excluded.search_text, data = excluded.data",
        row.id,
        row.chatId,
        row.seq,
        row.at,
        row.kind,
        row.card?.type ?? null,
        row.card?.state ?? null,
        row.text ?? null,
        json(row),
      );
    },
    getMessage(id) {
      return decode<MessageRow>(get("SELECT data FROM messages WHERE id = ?", id));
    },
    listMessages(chatId) {
      return decodeAll<MessageRow>(all("SELECT data FROM messages WHERE chat_id = ? ORDER BY seq", chatId));
    },
    putDraft(row) {
      execute(
        "INSERT INTO drafts VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET chat_id = excluded.chat_id, state = excluded.state, data = excluded.data",
        row.id,
        row.chatId,
        row.state,
        json(row),
      );
    },
    getDraft(id) {
      return decode<DraftRow>(get("SELECT data FROM drafts WHERE id = ?", id));
    },
    listDrafts(chatId) {
      return decodeAll<DraftRow>(all("SELECT data FROM drafts WHERE chat_id = ? ORDER BY rowid", chatId));
    },
    putSchedule(row) {
      execute(
        "INSERT INTO schedules VALUES (?, ?, ?, ?) ON CONFLICT(flow_id) DO UPDATE SET type = excluded.type, after_flow_id = excluded.after_flow_id, data = excluded.data",
        row.flowId,
        row.type,
        row.afterFlowId ?? null,
        json(row),
      );
    },
    getSchedule(flowId) {
      return decode<ScheduleRow>(get("SELECT data FROM schedules WHERE flow_id = ?", flowId));
    },
    listSchedules() {
      return decodeAll<ScheduleRow>(all("SELECT data FROM schedules ORDER BY flow_id"));
    },
    deleteSchedule(flowId) {
      execute("DELETE FROM schedules WHERE flow_id = ?", flowId);
    },
    saveFlow(draftId) {
      return store.transaction(() => {
        const draft = store.getDraft(draftId);
        if (!draft) throw new EngineError("not_found", "Draft not found.");
        if (draft.state === "saved" && draft.saved) return draft.saved;
        if (draft.state !== "drafted" || draft.kind !== "new_flow")
          throw new EngineError("invalid_input", "Draft cannot be saved.");
        const message = store.getMessage(draft.messageId);
        if (!message?.card || message.card.state !== "open")
          throw new EngineError("invalid_input", "Draft card is not open.");
        const source = draft.files["flow.yaml"];
        if (!source) throw new EngineError("invalid_input", "Flow manifest missing.");
        const parsed = parseManifest(parseFlowYaml(source));
        if (!parsed.ok) throw new EngineError("invalid_input", "Invalid flow manifest.");
        const flowId = newFlowId(store, draft.name);
        if (parsed.manifest.id !== flowId || parsed.manifest.name !== draft.name)
          throw new EngineError("invalid_input", "Draft identity changed.");
        const hash = contentHash(
          new Map(Object.entries(draft.files).map(([path, value]) => [path, Buffer.from(value)])),
        );
        if (hash !== draft.hash) throw new EngineError("invalid_input", "Draft hash changed.");
        const at = new Date().toISOString();
        const touches =
          parsed.manifest.format === "flowdriven-flow/1.2" ? (parsed.manifest.touches ?? []) : [];
        const selected = draft.lists.onItsOwn.map((id) => {
          const touch = touches.find((item) => item.id === id);
          if (!touch || touch.rule === "not_allowed")
            throw new EngineError("invalid_input", "Invalid confirmed touch.");
          return touch;
        });
        store.putFlow({
          id: flowId,
          hash,
          version: parsed.manifest.version,
          manifest: parsed.manifest,
          files: draft.files,
          registeredAt: at,
          format: parsed.manifest.format,
          savedBy: { kind: "save_flow", draftId },
        });
        store.putFlowHead({
          id: flowId,
          name: draft.name,
          summary: parsed.manifest.summary ?? "",
          headHash: hash,
          createdAt: at,
          updatedAt: at,
          origin: { kind: "chat", chatId: draft.chatId, draftId },
        });
        store.putConfirmation({
          flowId,
          hash,
          at,
          by: "save_flow",
          onItsOwn: draft.lists.onItsOwn,
          pins: { skills: {}, folders: {} },
          chatId: draft.chatId,
          draftId,
        });
        for (const touch of selected) {
          if (touch.effect === "read") continue;
          if (!touch.place) throw new EngineError("invalid_input", "A confirmed touch needs a fixed place.");
          store.makeRule({
            flowId,
            touchId: touch.id,
            effect: touch.effect,
            place: touch.place,
            sentence: touch.sentence,
            createdAt: at,
            createdBy: "confirm",
            confirmationHash: hash,
          });
        }
        if (draft.schedule)
          store.putSchedule({
            ...draft.schedule,
            flowId,
            setAt: at,
            setBy: "save_flow",
            confirmedHash: hash,
          });
        const saved = { flowId, hash, at };
        store.putDraft({ ...draft, state: "saved", saved, updatedAt: at });
        store.putMessage({
          ...message,
          card: { ...message.card, state: "answered", answer: { action: "save_flow", at } },
        });
        store.appendAudit({ at, kind: "flow_saved", detail: { flowId, hash, draftId, ...draft.lists } });
        return saved;
      });
    },
    getConfirmation: (id) =>
      decode<Confirmation>(get("SELECT data FROM confirmations WHERE flow_id = ?", id)),
    putConfirmation(row) {
      execute(
        "INSERT INTO confirmations VALUES (?, ?, ?) ON CONFLICT(flow_id) DO UPDATE SET hash = excluded.hash, data = excluded.data",
        row.flowId,
        row.hash,
        json(row),
      );
    },
    deleteConfirmation(flowId) {
      execute("DELETE FROM confirmations WHERE flow_id = ?", flowId);
    },
    confirmFlow({ confirmation, rules }) {
      store.transaction(() => {
        for (const existing of store.listRules()) {
          if (existing.flowId !== confirmation.flowId || existing.state !== "active") continue;
          const keep = rules.some(
            (rule) =>
              rule.touchId === existing.touchId &&
              rule.effect === existing.effect &&
              rule.place.kind === existing.place.kind &&
              rule.place.value === existing.place.value,
          );
          if (!keep)
            store.revokeRule(
              existing.id,
              confirmation.onItsOwn.includes(existing.touchId) ? "flow_changed" : "moved_to_asks_first",
            );
        }
        store.putConfirmation(confirmation);
        for (const rule of rules) {
          if (rule.flowId !== confirmation.flowId || !confirmation.onItsOwn.includes(rule.touchId))
            throw new EngineError("invalid_input", "Rule is not part of the confirmation.");
          store.makeRule(rule);
        }
        store.appendAudit({
          at: confirmation.at,
          kind: "flow_confirmed",
          detail: {
            flowId: confirmation.flowId,
            hash: confirmation.hash,
            onItsOwn: confirmation.onItsOwn,
            by: confirmation.by,
          },
        });
      });
    },
    schemaVersion: () => Number(db.prepare("PRAGMA user_version").get()?.user_version),
    getCapabilityConsent(flowId) {
      const row = get("SELECT flow_id, hash, at FROM capability_consents WHERE flow_id = ?", flowId);
      if (
        !row ||
        typeof row.flow_id !== "string" ||
        row.flow_id !== flowId ||
        typeof row.hash !== "string" ||
        typeof row.at !== "string"
      )
        return undefined;
      try {
        const hash: unknown = JSON.parse(row.hash);
        const at: unknown = JSON.parse(row.at);
        if (typeof hash !== "string" || typeof at !== "string") return undefined;
        const consent = { flowId, hash, at };
        const pinRow = get("SELECT pins FROM consent_pins WHERE flow_id = ?", flowId);
        if (typeof pinRow?.pins !== "string") return consent;
        try {
          const value: unknown = JSON.parse(pinRow.pins);
          const isRecord = (v: unknown): v is Record<string, unknown> =>
            v !== null && typeof v === "object" && !Array.isArray(v);
          if (!isRecord(value) || !isRecord(value.skills) || !isRecord(value.folders)) return consent;
          if (!Object.values(value.skills).every((v) => typeof v === "string")) return consent;
          if (
            !Object.values(value.folders).every(
              (v) =>
                isRecord(v) &&
                typeof v.path === "string" &&
                (v.access === "read" || v.access === "read_write"),
            )
          )
            return consent;
          return { ...consent, pins: value as ConsentPins };
        } catch {
          return consent;
        }
      } catch {
        return undefined;
      }
    },
    putCapabilityConsent(row) {
      store.transaction(() => {
        execute(
          "INSERT OR REPLACE INTO capability_consents (flow_id, hash, at) VALUES (?, ?, ?)",
          row.flowId,
          json(row.hash),
          json(row.at),
        );
        if (row.pins === undefined) execute("DELETE FROM consent_pins WHERE flow_id = ?", row.flowId);
        else
          execute(
            "INSERT OR REPLACE INTO consent_pins (flow_id, pins) VALUES (?, ?)",
            row.flowId,
            json(row.pins),
          );
      });
    },
    deleteCapabilityConsent(flowId) {
      store.transaction(() => {
        execute("DELETE FROM consent_pins WHERE flow_id = ?", flowId);
        execute("DELETE FROM capability_consents WHERE flow_id = ?", flowId);
        if (store.getConfirmation(flowId)?.legacy)
          execute("DELETE FROM confirmations WHERE flow_id = ?", flowId);
      });
    },
    getTrigger(flowId, index) {
      return decodeTrigger(
        get("SELECT flow_id, idx, data FROM triggers WHERE flow_id = ? AND idx = ?", flowId, index),
      );
    },
    putTrigger(row) {
      execute(
        "INSERT OR REPLACE INTO triggers (flow_id, idx, data) VALUES (?, ?, ?)",
        row.flowId,
        row.index,
        json(row),
      );
    },
    listTriggers(flowId) {
      return all(
        "SELECT flow_id, idx, data FROM triggers WHERE (? IS NULL OR flow_id = ?) ORDER BY flow_id, idx",
        flowId ?? null,
        flowId ?? null,
      )
        .map(decodeTrigger)
        .filter((row): row is TriggerRow => row !== undefined);
    },
    claimKey(flowId, index, key, at) {
      return (
        Number(
          execute("INSERT OR IGNORE INTO fire_keys VALUES (?, ?, ?, ?)", flowId, index, key, at).changes,
        ) === 1
      );
    },
    purgeKeys(before) {
      return Number(execute("DELETE FROM fire_keys WHERE at < ?", before).changes);
    },
    addUsage(row) {
      execute(
        "INSERT INTO usage_events (at, run_id, step_id, item_key, attempt, kind, harness, models, turns, wall_ms, queued_ms, memory_peak_mb, exit, cost_usd, billing) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        row.at,
        row.runId,
        row.stepId,
        row.itemKey,
        row.attempt,
        row.kind,
        row.harness,
        json(row.models),
        row.turns,
        row.wallMs,
        row.queuedMs,
        row.memoryPeakMb ?? null,
        row.exit,
        row.costUsd ?? null,
        row.billing ?? null,
      );
    },
    listUsage(filter) {
      return all(
        "SELECT * FROM usage_events WHERE (? IS NULL OR run_id = ?) AND (? IS NULL OR at >= ?) ORDER BY id",
        filter?.runId ?? null,
        filter?.runId ?? null,
        filter?.since ?? null,
        filter?.since ?? null,
      ).map((row) => ({
        at: String(row.at),
        runId: String(row.run_id),
        stepId: String(row.step_id),
        itemKey: String(row.item_key),
        attempt: Number(row.attempt),
        kind: row.kind as UsageEventRow["kind"],
        harness: String(row.harness),
        models: JSON.parse(String(row.models)) as UsageEventRow["models"],
        turns: Number(row.turns),
        wallMs: Number(row.wall_ms),
        queuedMs: Number(row.queued_ms),
        ...(row.memory_peak_mb === null ? {} : { memoryPeakMb: Number(row.memory_peak_mb) }),
        exit: row.exit as UsageEventRow["exit"],
        ...(row.cost_usd === null ? {} : { costUsd: Number(row.cost_usd) }),
        ...(row.billing === null ? {} : { billing: row.billing as "plan" | "per_use" }),
      }));
    },
    recentPeaks(q) {
      if (!Number.isSafeInteger(q.runs) || q.runs < 0)
        throw new EngineError("invalid_input", "Run count must be a non-negative integer.");
      return all(
        "SELECT MAX(u.memory_peak_mb) AS peak FROM usage_events u JOIN runs r ON r.id = u.run_id WHERE r.flow_id = ? AND u.step_id = ? AND u.kind = ? AND u.harness = ? AND u.memory_peak_mb IS NOT NULL GROUP BY u.run_id ORDER BY MIN(u.id) DESC LIMIT ?",
        q.flowId,
        q.stepId,
        q.kind,
        q.harness,
        q.runs,
      ).map((row) => Number(row.peak));
    },
    retentionCandidates(before90, before30) {
      const queries: [RetentionRow["table"], string, string[]][] = [
        [
          "runs",
          `SELECT r.rowid FROM runs r WHERE r.rowid NOT IN (SELECT rowid FROM (SELECT rowid, ROW_NUMBER() OVER (PARTITION BY flow_id ORDER BY COALESCE(json_extract(data, '$.endedAt'), json_extract(data, '$.startedAt')) DESC, rowid DESC) AS n FROM runs) WHERE n <= 50) AND r.state IN ('done','failed','stopped','cancelled') AND json_extract(r.data, '$.endedAt') < ? AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.run_id = r.id AND a.state = 'pending') AND NOT EXISTS (SELECT 1 FROM waiting_questions q WHERE q.state = 'open' AND (json_extract(q.data, '$.runId') = r.id OR json_extract(q.data, '$.pendingStart.request.fromRunId') = r.id OR json_extract(q.data, '$.pendingStart.request.afterRunId') = r.id))`,
          [before90],
        ],
        [
          "starts",
          `SELECT s.rowid FROM starts s WHERE s.at < ? AND s.rowid NOT IN (SELECT rowid FROM (SELECT rowid, ROW_NUMBER() OVER (PARTITION BY flow_id ORDER BY at DESC, rowid DESC) AS n FROM starts) WHERE n <= 50) AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.id = json_extract(s.data, '$.runId'))`,
          [before90],
        ],
        [
          "standing_rules",
          "SELECT rowid FROM standing_rules WHERE state = 'revoked' AND json_extract(data, '$.revokedAt') < ?",
          [before90],
        ],
        [
          "waiting_questions",
          "SELECT rowid FROM waiting_questions WHERE state IN ('answered','cancelled','closed') AND json_extract(data, '$.updatedAt') < ?",
          [before30],
        ],
        ["seen", "SELECT rowid FROM seen WHERE at < ?", [before30]],
        ["fire_keys", "SELECT rowid FROM fire_keys WHERE at < ?", [before30]],
        [
          "flows",
          "SELECT f.rowid FROM flows f JOIN flow_heads h ON h.id = f.id WHERE h.deleted_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.flow_id = f.id AND json_extract(r.data, '$.flowHash') = f.hash)",
          [],
        ],
      ];
      return queries.flatMap(([table, sql, args]) =>
        all(sql, ...args).map((row) => ({ table, rowid: Number(row.rowid) })),
      );
    },
    deleteRetentionRows(rows) {
      for (const row of rows) {
        if (row.table === "runs") {
          const run = get("SELECT id FROM runs WHERE rowid = ?", row.rowid);
          if (!run) continue;
          for (const table of ["steps", "items", "approvals", "grants", "call_grants", "usage_events"])
            execute(`DELETE FROM ${table} WHERE run_id = ?`, String(run.id));
        }
        execute(`DELETE FROM ${row.table} WHERE rowid = ?`, row.rowid);
      }
    },
    getSetting(name) {
      return decode(get("SELECT data FROM settings WHERE name = ?", name));
    },
    deleteSetting(name) {
      execute("DELETE FROM settings WHERE name = ?", name);
    },
    putSetting(name, value) {
      execute("INSERT OR REPLACE INTO settings (name, data) VALUES (?, ?)", name, json(value));
    },
    getHarnessState(id) {
      return decode<StoredAgentRow>(get("SELECT data FROM harness_state WHERE id = ?", id));
    },
    putHarnessState(row) {
      let data: string;
      try {
        data = json(row);
      } catch {
        throw new EngineError("invalid_input", "Value is not JSON serializable.");
      }
      execute("INSERT OR REPLACE INTO harness_state (id, data) VALUES (?, ?)", row.id, data);
    },
    transaction<T>(fn: () => T): T {
      const level = depth;
      const savepoint = `store_${level}`;
      db.exec(level === 0 ? "BEGIN" : `SAVEPOINT ${savepoint}`);
      depth++;
      try {
        const result = fn();
        db.exec(level === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        db.exec(level === 0 ? "ROLLBACK" : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
        throw error;
      } finally {
        depth--;
      }
    },
    putFlow(row) {
      execute("INSERT OR REPLACE INTO flows (id, hash, data) VALUES (?, ?, ?)", row.id, row.hash, json(row));
    },
    addVersion(id, files, options) {
      return store.transaction(() => {
        const head = store.getFlowHead(id);
        if (!head || head.deletedAt) throw new EngineError("not_found", "Flow not found.");
        const hash = contentHash(
          new Map(Object.entries(files).map(([path, value]) => [path, Buffer.from(value)])),
        );
        if (hash === head.headHash) {
          const existing = store.getFlow(id, hash);
          if (!existing) throw new EngineError("not_found", "Flow version not found.");
          return existing;
        }
        const source = files["flow.yaml"];
        if (!source) throw new EngineError("invalid_input", "Flow manifest missing.");
        const parsed = parseManifest(parseFlowYaml(source));
        if (!parsed.ok || parsed.manifest.id !== id)
          throw new EngineError("invalid_input", "Invalid flow manifest.");
        const at = new Date().toISOString();
        const row: FlowRow = {
          id,
          hash,
          version: parsed.manifest.version,
          manifest: parsed.manifest,
          files,
          registeredAt: at,
          format: parsed.manifest.format,
          savedBy: options.savedBy,
          parentHash: head.headHash,
        };
        store.putFlow(row);
        store.putFlowHead({ ...head, headHash: hash, updatedAt: at });
        return row;
      });
    },
    getFlow(id, hash) {
      const headHash = hash ?? store.getFlowHead(id)?.headHash;
      return decode<FlowRow>(
        headHash === undefined
          ? get("SELECT data FROM flows WHERE id = ? ORDER BY rowid DESC LIMIT 1", id)
          : get("SELECT data FROM flows WHERE id = ? AND hash = ?", id, headHash),
      );
    },
    listFlows() {
      return decodeAll<FlowRow>(
        all(
          "SELECT f.data FROM flows f LEFT JOIN flow_heads h ON h.id = f.id WHERE (h.id IS NOT NULL AND h.deleted_at IS NULL AND f.hash = json_extract(h.data, '$.headHash')) OR (h.id IS NULL AND f.rowid = (SELECT MAX(f2.rowid) FROM flows f2 WHERE f2.id = f.id)) ORDER BY f.id",
        ),
      );
    },
    createRun(row) {
      execute("INSERT INTO runs VALUES (?, ?, ?, ?)", row.id, row.flowId, row.state, json(row));
    },
    updateRun(id, patch) {
      const row = store.getRun(id);
      if (!row) throw new EngineError("not_found", "Run not found.");
      const next = { ...row, ...patch };
      execute(
        "UPDATE runs SET flow_id = ?, state = ?, data = ? WHERE id = ?",
        next.flowId,
        next.state,
        json(next),
        id,
      );
    },
    getRun(id) {
      return decodeRun(get("SELECT data FROM runs WHERE id = ?", id));
    },
    listRuns(filter) {
      return all(
        "SELECT data FROM runs WHERE (? IS NULL OR flow_id = ?) AND (? IS NULL OR state = ?) ORDER BY rowid",
        filter?.flowId ?? null,
        filter?.flowId ?? null,
        filter?.state ?? null,
        filter?.state ?? null,
      ).flatMap((row) => {
        const run = decodeRun(row);
        return run ? [run] : [];
      });
    },
    upsertStep(row) {
      execute(
        "INSERT INTO steps VALUES (?, ?, ?, ?) ON CONFLICT(run_id, step_id, item_key) DO UPDATE SET data = excluded.data",
        row.runId,
        row.stepId,
        row.itemKey,
        json(row),
      );
    },
    getStep(runId, stepId, itemKey = "") {
      return decode<StepRow>(
        get(
          "SELECT data FROM steps WHERE run_id = ? AND step_id = ? AND item_key = ?",
          runId,
          stepId,
          itemKey,
        ),
      );
    },
    listSteps(runId) {
      return decodeAll<StepRow>(all("SELECT data FROM steps WHERE run_id = ? ORDER BY rowid", runId));
    },
    upsertItem(row) {
      execute(
        "INSERT INTO items VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id, loop_id, position) DO UPDATE SET key = excluded.key, data = excluded.data",
        row.runId,
        row.loopId,
        row.key,
        row.position,
        json(row),
      );
    },
    listItems(runId, loopId) {
      return decodeAll<ItemRow>(
        all(
          "SELECT data FROM items WHERE run_id = ? AND (? IS NULL OR loop_id = ?) ORDER BY position, rowid",
          runId,
          loopId ?? null,
          loopId ?? null,
        ),
      );
    },
    isSeen(flowId, loopId, key) {
      return (
        get("SELECT 1 FROM seen WHERE flow_id = ? AND loop_id = ? AND key = ?", flowId, loopId, key) !==
        undefined
      );
    },
    markSeen(flowId, loopId, key, at) {
      execute(
        "INSERT INTO seen VALUES (?, ?, ?, ?) ON CONFLICT(flow_id, loop_id, key) DO UPDATE SET at = excluded.at",
        flowId,
        loopId,
        key,
        at,
      );
    },
    purgeSeen(before) {
      return Number(execute("DELETE FROM seen WHERE at < ?", before).changes);
    },
    createApproval(row) {
      execute("INSERT INTO approvals VALUES (?, ?, ?, ?)", row.id, row.runId, row.state, json(row));
    },
    getApproval(id) {
      try {
        return decode<ApprovalRow>(get("SELECT data FROM approvals WHERE id = ?", id));
      } catch {
        return undefined;
      }
    },
    listApprovals(filter) {
      return all(
        "SELECT data FROM approvals WHERE (? IS NULL OR state = ?) AND (? IS NULL OR run_id = ?) ORDER BY rowid",
        filter?.state ?? null,
        filter?.state ?? null,
        filter?.runId ?? null,
        filter?.runId ?? null,
      ).flatMap((row) => {
        try {
          return [JSON.parse(String(row.data)) as ApprovalRow];
        } catch {
          return [];
        }
      });
    },
    updateApproval(id, patch) {
      const row = store.getApproval(id);
      if (!row) throw new EngineError("not_found", "Approval not found.");
      const next = { ...row, ...patch };
      execute(
        "UPDATE approvals SET run_id = ?, state = ?, data = ? WHERE id = ?",
        next.runId,
        next.state,
        json(next),
        id,
      );
    },
    addGrant(runId, tool, itemKey) {
      execute("INSERT OR IGNORE INTO grants VALUES (?, ?, ?)", runId, tool, itemKey);
    },
    hasGrant(runId, tool, itemKey) {
      return (
        get("SELECT 1 FROM grants WHERE run_id = ? AND tool = ? AND item_key = ?", runId, tool, itemKey) !==
        undefined
      );
    },
    increment(name, day, by = 1) {
      if (!Number.isSafeInteger(by))
        throw new EngineError("invalid_input", "Counter increment must be an integer.");
      execute(
        "INSERT INTO counters VALUES (?, ?, ?) ON CONFLICT(name, day) DO UPDATE SET value = value + excluded.value",
        name,
        day,
        by,
      );
      return store.counter(name, day);
    },
    counter(name, day) {
      const value = get("SELECT value FROM counters WHERE name = ? AND day = ?", name, day)?.value;
      return value === undefined ? 0 : Number(value);
    },
    appendAudit(entry) {
      execute(
        "INSERT INTO audit_log (at, kind, run_id, detail) VALUES (?, ?, ?, ?)",
        entry.at,
        entry.kind,
        entry.runId ?? null,
        json(entry.detail),
      );
    },
    listAudit(runId) {
      return all(
        "SELECT at, kind, run_id, detail FROM audit_log WHERE (? IS NULL OR run_id = ?) ORDER BY id",
        runId ?? null,
        runId ?? null,
      ).map((row) => ({
        at: String(row.at),
        kind: String(row.kind),
        ...(row.run_id === null ? {} : { runId: String(row.run_id) }),
        detail: JSON.parse(String(row.detail)) as AuditEntry["detail"],
      }));
    },
    listAuditRecords(filter) {
      return all(
        "SELECT id, at, kind, run_id, detail FROM audit_log WHERE (? IS NULL OR run_id = ?) AND id > ? ORDER BY id LIMIT ?",
        filter.runId ?? null,
        filter.runId ?? null,
        filter.afterId ?? 0,
        filter.limit ?? 200,
      ).map((row) => ({
        id: Number(row.id),
        at: String(row.at),
        kind: String(row.kind),
        ...(row.run_id === null ? {} : { runId: String(row.run_id) }),
        detail: JSON.parse(String(row.detail)) as AuditEntry["detail"],
      }));
    },
    close() {
      db.close();
    },
  };
  return store;
}
