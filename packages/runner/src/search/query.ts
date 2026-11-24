import type { Store } from "../storage.ts";

export type SearchChatHit = {
  chatId: string;
  title: string;
  updatedAt: string;
  snippet?: string;
  outside: boolean;
};

export type SearchFlowHit = {
  flowId: string;
  name: string;
  summary: string;
};

export type SearchQueryResult = {
  recent: boolean;
  chats: SearchChatHit[];
  flows: SearchFlowHit[];
};

const RECENT_CHAT_LIMIT = 5;
const SEARCH_CHAT_LIMIT = 20;
const RECENT_FLOW_LIMIT = 200;
const SEARCH_FLOW_LIMIT = 50;
const SNIPPET_MAX = 160;

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function buildSnippet(text: string, query: string, maxLen = SNIPPET_MAX): string {
  if (text.length <= maxLen) return text;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return text.slice(0, maxLen);
  const center = index + Math.floor(query.length / 2);
  let start = Math.max(0, center - Math.floor(maxLen / 2));
  if (query.length >= maxLen) start = Math.min(start, index);
  if (start + maxLen > text.length) start = Math.max(0, text.length - maxLen);
  return text.slice(start, start + maxLen);
}

/** Searches chats and live flows using escaped LIKE queries with bounded limits. */
export function searchQuery(store: Store, text: string): SearchQueryResult {
  const query = text.trim();
  if (query.length === 0) {
    const chatRows = store.searchRows(
      `SELECT id, title, updated_at FROM chats ORDER BY updated_at DESC, id ASC LIMIT ${RECENT_CHAT_LIMIT}`,
    );
    const flowRows = store.searchRows(
      `SELECT id, name, summary FROM flow_heads WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE ASC, id ASC LIMIT ${RECENT_FLOW_LIMIT}`,
    );
    return {
      recent: true,
      chats: chatRows.map((row) => ({
        chatId: String(row.id),
        title: String(row.title),
        updatedAt: String(row.updated_at),
        outside: false,
      })),
      flows: flowRows.map((row) => ({
        flowId: String(row.id),
        name: String(row.name),
        summary: String(row.summary),
      })),
    };
  }

  const pattern = `%${escapeLike(query)}%`;
  const chatRows = store.searchRows(
    `SELECT c.id, c.title, c.updated_at,
  (SELECT m.search_text FROM messages m WHERE m.chat_id = c.id AND m.search_text LIKE ? ESCAPE '\\' ORDER BY m.seq DESC LIMIT 1) AS match_text,
  (SELECT json_extract(m.data, '$.outside') FROM messages m WHERE m.chat_id = c.id AND m.search_text LIKE ? ESCAPE '\\' ORDER BY m.seq DESC LIMIT 1) AS match_outside
FROM chats c
WHERE c.title LIKE ? ESCAPE '\\'
   OR EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id AND m.search_text LIKE ? ESCAPE '\\')
ORDER BY c.updated_at DESC, c.id ASC
LIMIT ${SEARCH_CHAT_LIMIT}`,
    [pattern, pattern, pattern, pattern],
  );
  const flowRows = store.searchRows(
    `SELECT id, name, summary
FROM flow_heads
WHERE deleted_at IS NULL AND (name LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')
ORDER BY name COLLATE NOCASE ASC, id ASC
LIMIT ${SEARCH_FLOW_LIMIT}`,
    [pattern, pattern],
  );
  return {
    recent: false,
    chats: chatRows.map((row) => {
      const matchText = typeof row.match_text === "string" ? row.match_text : undefined;
      return {
        chatId: String(row.id),
        title: String(row.title),
        updatedAt: String(row.updated_at),
        ...(matchText !== undefined ? { snippet: buildSnippet(matchText, query) } : {}),
        outside: matchText !== undefined && (row.match_outside === 1 || row.match_outside === true),
      };
    }),
    flows: flowRows.map((row) => ({
      flowId: String(row.id),
      name: String(row.name),
      summary: String(row.summary),
    })),
  };
}
