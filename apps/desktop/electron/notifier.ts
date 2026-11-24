import noticeWords from "./notice-words.json";

type NoticeKind =
  | "approval_waiting"
  | "run_blocked"
  | "weekly_limit"
  | "flood_cap"
  | "trigger_paused"
  | "question_waiting"
  | "confirm_waiting";
type NoticeKey = keyof typeof noticeWords.en;
export type ParsedNotice = {
  id: string;
  kind: NoticeKind;
  title: { key: string };
  body: { key: string };
  language: string;
  target:
    | { screen: "run"; runId: string; approvalId?: string }
    | { screen: "chat"; chatId: string }
    | { screen: "flow"; flowId: string }
    | { screen: "activity" | "settings" };
};
const families: Record<NoticeKind, string> = {
  approval_waiting: "decision",
  run_blocked: "problem",
  weekly_limit: "limit",
  flood_cap: "limit",
  trigger_paused: "limit",
  question_waiting: "question",
  confirm_waiting: "question",
};
export function noticeWord(language: string, key: string): string {
  const words = language === "id" ? noticeWords.id : noticeWords.en;
  return words[key.replace(/^notice\./, "") as NoticeKey] ?? "";
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}
function id(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,100}$/.test(value);
}
export function parseNotice(value: unknown): ParsedNotice | undefined {
  if (
    !object(value) ||
    !keys(value, ["id", "kind", "title", "body", "language", "target"]) ||
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 200 ||
    typeof value.kind !== "string" ||
    !Object.hasOwn(families, value.kind) ||
    typeof value.language !== "string" ||
    !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value.language) ||
    !object(value.title) ||
    !object(value.body) ||
    !keys(value.title, ["key"]) ||
    !keys(value.body, ["key"]) ||
    !object(value.target)
  )
    return undefined;
  const kind = value.kind as NoticeKind;
  if (
    value.title.key !== `notice.${families[kind]}Title` ||
    value.body.key !== `notice.${families[kind]}Body`
  )
    return undefined;
  const target = value.target;
  let parsedTarget: ParsedNotice["target"];
  if (
    target.screen === "run" &&
    keys(target, ["screen", "runId"], ["approvalId"]) &&
    id(target.runId) &&
    (!Object.hasOwn(target, "approvalId") || id(target.approvalId))
  )
    parsedTarget =
      typeof target.approvalId === "string"
        ? { screen: "run", runId: target.runId, approvalId: target.approvalId }
        : { screen: "run", runId: target.runId };
  else if (target.screen === "chat" && keys(target, ["screen", "chatId"]) && id(target.chatId))
    parsedTarget = { screen: "chat", chatId: target.chatId };
  else if (target.screen === "flow" && keys(target, ["screen", "flowId"]) && id(target.flowId))
    parsedTarget = { screen: "flow", flowId: target.flowId };
  else if ((target.screen === "activity" || target.screen === "settings") && keys(target, ["screen"]))
    parsedTarget = { screen: target.screen };
  else return undefined;
  return {
    id: value.id,
    kind,
    title: { key: value.title.key },
    body: { key: value.body.key },
    language: value.language === "id" ? "id" : "en",
    target: parsedTarget,
  };
}
export function hashFor(target: ParsedNotice["target"]): string {
  if (target.screen === "run") return `/activity/${encodeURIComponent(target.runId)}`;
  if (target.screen === "chat") return `/chat/${encodeURIComponent(target.chatId)}`;
  if (target.screen === "flow") return `/flows/${encodeURIComponent(target.flowId)}`;
  return `/${target.screen}`;
}
export function createNoticeHandler(o: {
  words?: (language: string, key: string) => string;
  show: (notice: { title: string; body: string }, onClick: () => void) => void;
  windowFocused: () => boolean;
  open: (hash: string) => void;
}): (value: unknown) => void {
  const sent = new Set<string>();
  return (value) => {
    const notice = parseNotice(value);
    if (!notice || o.windowFocused() || sent.has(notice.id)) return;
    try {
      const words = o.words ?? noticeWord;
      const cut = (value: string, max: number) =>
        value.length > max ? `${value.slice(0, max - 3)}...` : value;
      o.show(
        {
          title: cut(words(notice.language, notice.title.key), 80),
          body: cut(words(notice.language, notice.body.key), 240),
        },
        () => o.open(hashFor(notice.target)),
      );
      sent.add(notice.id);
      if (sent.size > 200) {
        const first = sent.values().next().value;
        if (first !== undefined) sent.delete(first);
      }
    } catch {}
  };
}
type NotificationInstance = {
  on(event: "click" | "close", fn: () => void): unknown;
  show(): void;
};
type NotificationCtor = {
  new (options: { title: string; body: string }): NotificationInstance;
  isSupported(): boolean;
};
export function electronNoticeHandler(o: {
  Notification: NotificationCtor;
  words?: (language: string, key: string) => string;
  windows: () => { isFocused(): boolean }[];
  open: (hash: string) => void;
}): (value: unknown) => void {
  const active = new Set<NotificationInstance>();
  const handle = createNoticeHandler({
    words: o.words,
    windowFocused: () => o.windows().some((window) => window.isFocused()),
    open: o.open,
    show: (notice, click) => {
      const notification = new o.Notification(notice);
      active.add(notification);
      try {
        notification.on("click", () => {
          active.delete(notification);
          click();
        });
        notification.on("close", () => {
          active.delete(notification);
        });
        notification.show();
      } catch (error) {
        active.delete(notification);
        throw error;
      }
    },
  });
  return (value) => {
    if (o.Notification.isSupported()) handle(value);
  };
}
