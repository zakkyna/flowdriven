export type ParsedNotice = {
  id: string;
  kind: "approval_waiting" | "run_blocked" | "weekly_limit" | "flood_cap" | "trigger_paused";
  title: string;
  body: string;
  target:
    | { screen: "inbox"; approvalId?: string }
    | { screen: "run"; runId: string }
    | { screen: "builder"; flowId: string };
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}
function text(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || (code >= 127 && code <= 159);
    })
  );
}
function id(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,100}$/.test(value);
}
export function parseNotice(value: unknown): ParsedNotice | undefined {
  if (
    !object(value) ||
    !keys(value, ["id", "kind", "title", "body", "target"]) ||
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 200 ||
    !text(value.title, 80) ||
    !text(value.body, 240) ||
    !object(value.target)
  )
    return undefined;
  const kind = value.kind;
  if (
    kind !== "approval_waiting" &&
    kind !== "run_blocked" &&
    kind !== "weekly_limit" &&
    kind !== "flood_cap" &&
    kind !== "trigger_paused"
  )
    return undefined;
  const target = value.target;
  let parsedTarget: ParsedNotice["target"];
  if (
    target.screen === "inbox" &&
    keys(target, ["screen"], ["approvalId"]) &&
    (!Object.hasOwn(target, "approvalId") || id(target.approvalId))
  ) {
    parsedTarget =
      typeof target.approvalId === "string"
        ? { screen: "inbox", approvalId: target.approvalId }
        : { screen: "inbox" };
  } else if (target.screen === "run" && keys(target, ["screen", "runId"]) && id(target.runId)) {
    parsedTarget = { screen: "run", runId: target.runId };
  } else if (target.screen === "builder" && keys(target, ["screen", "flowId"]) && id(target.flowId)) {
    parsedTarget = { screen: "builder", flowId: target.flowId };
  } else return undefined;
  return { id: value.id, kind, title: value.title, body: value.body, target: parsedTarget };
}
export function hashFor(target: ParsedNotice["target"]): string {
  if (target.screen === "inbox")
    return target.approvalId === undefined ? "/inbox" : `/inbox/${encodeURIComponent(target.approvalId)}`;
  if (target.screen === "run") return `/runs/${encodeURIComponent(target.runId)}`;
  return `/builder/${encodeURIComponent(target.flowId)}`;
}
export function createNoticeHandler(o: {
  show: (notice: { title: string; body: string }, onClick: () => void) => void;
  windowFocused: () => boolean;
  open: (hash: string) => void;
}): (value: unknown) => void {
  const sent = new Set<string>();
  return (value) => {
    const notice = parseNotice(value);
    if (!notice || o.windowFocused() || sent.has(notice.id)) return;
    try {
      o.show({ title: notice.title, body: notice.body }, () => o.open(hashFor(notice.target)));
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
  windows: () => { isFocused(): boolean }[];
  open: (hash: string) => void;
}): (value: unknown) => void {
  const active = new Set<NotificationInstance>();
  const handle = createNoticeHandler({
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
