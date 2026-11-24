import {
  CardView,
  ChatSummary,
  ChatView,
  type OperationInput,
  RunnerError,
  type RunnerTopic,
} from "@flowdriven/contracts";
import { AGENT_CATALOG, type CatalogEntry } from "../agents/catalog.ts";
import type { createAgentRegistry } from "../agents/registry.ts";
import type { ChatRow, MessageRow, Store, StoredAgentRow } from "../storage.ts";
import { toDecision } from "./map-decision.ts";
import { appLanguage, readSettings } from "./settings.ts";

type ChatHandlerDeps = {
  store: Store;
  registry: ReturnType<typeof createAgentRegistry>;
  catalog: CatalogEntry[];
  languages: readonly string[];
  now: () => Date;
  newId: (prefix: string) => string;
  markChanged?: (topic: RunnerTopic) => void;
};

function compareVersions(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function catalogDefaultModel(entry: CatalogEntry, version?: string): string {
  const keys = Object.keys(entry.models).sort(compareVersions);
  const matching = version ? keys.filter((k) => compareVersions(k, version) <= 0).at(-1) : undefined;
  const list = entry.models[matching ?? keys[0] ?? ""] ?? [];
  return list.find((m) => m.isDefault)?.id ?? list.at(0)?.id ?? "sonnet-5.5";
}

function defaultModelFor(entry: CatalogEntry, row: StoredAgentRow | undefined): string {
  const list = row?.models?.list;
  if (list?.length) return list.find((m) => m.isDefault)?.id ?? list[0]?.id ?? catalogDefaultModel(entry);
  return catalogDefaultModel(entry, row?.version);
}

function modelDisplayName(catalog: CatalogEntry[], agentId: string, modelId: string): string {
  for (const source of [catalog, AGENT_CATALOG]) {
    const entry = source.find((item) => item.id === agentId);
    if (!entry) continue;
    for (const models of Object.values(entry.models)) {
      const match = models.find((m) => m.id === modelId);
      if (match) return match.name;
    }
  }
  return modelId;
}

export function createChatHandlers({
  store,
  registry,
  catalog,
  languages,
  now,
  newId,
  markChanged,
}: ChatHandlerDeps) {
  const resolveInitialAgent = (): {
    agent: string;
    model: string;
    fallbackNote?: { main: string; agent: string };
  } => {
    const main = readSettings(store, now(), languages).mainAgent;
    const firstReady = catalog.find((entry) => store.getHarnessState(entry.id)?.state === "ready");
    if (main !== null) {
      const mainRow = store.getHarnessState(main.agent);
      if (mainRow?.state === "ready") {
        const listed = mainRow.models?.list;
        const entry = catalog.find((item) => item.id === main.agent);
        const model =
          listed?.length && !listed.some((m) => m.id === main.model)
            ? (listed.find((m) => m.isDefault)?.id ??
              listed[0]?.id ??
              (entry ? catalogDefaultModel(entry, mainRow.version) : main.model))
            : main.model;
        return { agent: main.agent, model };
      }
      if (firstReady) {
        return {
          agent: firstReady.id,
          model: defaultModelFor(firstReady, store.getHarnessState(firstReady.id)),
          fallbackNote: { main: main.agent, agent: firstReady.id },
        };
      }
      return { agent: main.agent, model: main.model };
    }
    if (firstReady) {
      return {
        agent: firstReady.id,
        model: defaultModelFor(firstReady, store.getHarnessState(firstReady.id)),
      };
    }
    const fallbackEntry = catalog.find((entry) => entry.id === "claude-code") ?? catalog[0];
    if (!fallbackEntry) return { agent: "claude-code", model: "sonnet-5.5" };
    return {
      agent: fallbackEntry.id,
      model: defaultModelFor(fallbackEntry, store.getHarnessState(fallbackEntry.id)),
    };
  };

  const toChatSummary = (chat: ChatRow) => {
    const waiting = store.listQuestions().some((q) => q.chatId === chat.id && q.state === "open");
    return ChatSummary.parse({
      id: chat.id,
      title: chat.title,
      updatedAt: chat.updatedAt,
      from: chat.from,
      agent: chat.agent,
      model: chat.model,
      language: chat.language,
      waiting,
    });
  };

  const toMessageView = (row: MessageRow) => {
    let card: unknown;
    if (row.card) {
      if (
        row.card.type === "decision" &&
        "approvalId" in row.card &&
        typeof row.card.approvalId === "string"
      ) {
        const approval = store.getApproval(row.card.approvalId);
        const run = approval ? store.getRun(approval.runId) : undefined;
        if (approval && run) {
          card = {
            type: "decision" as const,
            state: row.card.state,
            ...(row.card.answer ? { answer: row.card.answer } : {}),
            decision: toDecision(approval, run, store),
          };
        }
      } else {
        const parsed = CardView.safeParse(row.card);
        if (parsed.success) card = parsed.data;
      }
    }
    return {
      id: row.id,
      seq: row.seq,
      at: row.at,
      role: row.role,
      kind: row.kind,
      outside: row.outside,
      ...(row.text === undefined ? {} : { text: row.text }),
      ...(row.line === undefined ? {} : { line: row.line }),
      ...(row.result === undefined ? {} : { result: row.result }),
      ...(card === undefined ? {} : { card }),
      ...(row.chips === undefined ? {} : { chips: row.chips }),
      ...(row.language === undefined ? {} : { language: row.language }),
    };
  };

  return {
    create(input: OperationInput<"chats.create">) {
      if (input.subject?.kind === "improve") {
        const flow = store.getFlow(input.subject.flowId);
        const head = store.getFlowHead(input.subject.flowId);
        if (!flow || head?.deletedAt)
          throw new RunnerError("not_found", "Flow not found.", { reason: "flow_deleted" });
      }
      const at = now().toISOString();
      const language = appLanguage(store, languages);
      const initial = resolveInitialAgent();
      return store.transaction(() => {
        const existing = store.listChats().find((chat) => store.listMessages(chat.id).length === 0);
        let chatId: string;
        let reused = false;
        if (existing) {
          reused = true;
          chatId = existing.id;
          const { subject: _previousSubject, ...base } = existing;
          store.putChat({
            ...base,
            updatedAt: at,
            agent: initial.agent,
            model: initial.model,
            agentSource: "main_default",
            language,
            languageSource: "app",
            ...(input.subject ? { subject: input.subject } : {}),
          });
        } else {
          chatId = newId("chat");
          store.putChat({
            id: chatId,
            title: "",
            titleSource: "default",
            createdAt: at,
            updatedAt: at,
            from: "person",
            language,
            languageSource: "app",
            agent: initial.agent,
            model: initial.model,
            agentSource: "main_default",
            ...(input.subject ? { subject: input.subject } : {}),
          });
        }
        if (initial.fallbackNote) {
          store.putMessage({
            id: newId("msg"),
            chatId,
            seq: 1,
            at,
            role: "flowdriven",
            kind: "note",
            line: { key: "chat.mainAgentNotReady", params: initial.fallbackNote },
            language,
            outside: false,
          });
        }
        return { chatId, reused };
      });
    },

    get(input: OperationInput<"chats.get">) {
      let chat = store.getChat(input.chatId);
      if (!chat) throw new RunnerError("not_found", "Chat not found.");
      const agentRow = store.getHarnessState(chat.agent);
      const listed = agentRow?.state === "ready" ? agentRow.models?.list : undefined;
      if (listed?.length && !listed.some((m) => m.id === chat?.model)) {
        const fallback = listed.find((m) => m.isDefault) ?? listed[0];
        if (fallback) {
          const oldName = modelDisplayName(catalog, chat.agent, chat.model);
          const at = now().toISOString();
          const language = appLanguage(store, languages);
          const current = chat;
          chat = store.transaction(() => {
            const updated: ChatRow = { ...current, model: fallback.id, agentSource: "model_gone" };
            store.putChat(updated);
            const seq = (store.listMessages(updated.id).at(-1)?.seq ?? 0) + 1;
            store.putMessage({
              id: newId("msg"),
              chatId: updated.id,
              seq,
              at,
              role: "flowdriven",
              kind: "note",
              line: {
                key: "chat.modelGone",
                params: { old: oldName, agent: updated.agent, model: fallback.id },
              },
              language,
              outside: false,
            });
            return updated;
          });
          markChanged?.("chats");
        }
      }
      const all = store.listMessages(chat.id);
      const before = input.before;
      const filtered = before === undefined ? all : all.filter((m) => m.seq < before);
      const limit = input.limit ?? 200;
      const more = filtered.length > limit;
      const messages = filtered.slice(-limit).map(toMessageView);
      return ChatView.parse({
        chat: {
          ...toChatSummary(chat),
          ...(chat.subject ? { subject: chat.subject } : {}),
        },
        messages,
        more,
        turn: { state: "idle", queued: 0 },
        composerText: chat.composerText ?? "",
      });
    },

    async setAgent(input: OperationInput<"chats.setAgent">) {
      const chat = store.getChat(input.chatId);
      if (!chat) throw new RunnerError("not_found", "Chat not found.");
      const models = await registry.models(input.agent);
      if (models.error) {
        if (models.error === "agent_unknown")
          throw new RunnerError("not_found", "Agent not found.", { reason: "agent_unknown" });
        throw new RunnerError("not_allowed", "Agent is not ready.", { reason: "agent_not_ready" });
      }
      if (!models.list.some((m) => m.id === input.model))
        throw new RunnerError("invalid_input", "Unknown model.", { reason: "model_unknown" });
      const at = now().toISOString();
      const language = appLanguage(store, languages);
      return store.transaction(() => {
        const updated: ChatRow = {
          ...chat,
          agent: input.agent,
          model: input.model,
          agentSource: "person",
        };
        store.putChat(updated);
        const seq = (store.listMessages(updated.id).at(-1)?.seq ?? 0) + 1;
        store.putMessage({
          id: newId("msg"),
          chatId: updated.id,
          seq,
          at,
          role: "flowdriven",
          kind: "note",
          line: {
            key: "chat.agentChanged",
            params: { agent: input.agent, model: input.model },
          },
          language,
          outside: false,
        });
        store.appendAudit({
          at,
          kind: "chat_agent_changed",
          detail: { chatId: updated.id, agent: input.agent, model: input.model },
        });
        return toChatSummary(updated);
      });
    },

    delete(input: OperationInput<"chats.delete">) {
      if (!store.getChat(input.chatId)) throw new RunnerError("not_found", "Chat not found.");
      store.deleteChat(input.chatId, now().toISOString());
      return { deleted: true as const };
    },
  };
}
