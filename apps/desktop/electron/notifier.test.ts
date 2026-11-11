import { expect, test, vi } from "vitest";
import { createNoticeHandler, electronNoticeHandler, hashFor, parseNotice } from "./notifier";

const notice = {
  id: "one",
  kind: "approval_waiting",
  title: "Waiting",
  body: "Please check",
  target: { screen: "inbox", approvalId: "a:1" },
};

test("parseNotice accepts a notice of each of the five kinds with its target", () => {
  for (const [kind, target] of [
    ["approval_waiting", { screen: "inbox", approvalId: "a" }],
    ["run_blocked", { screen: "run", runId: "r" }],
    ["weekly_limit", { screen: "inbox" }],
    ["flood_cap", { screen: "builder", flowId: "f" }],
    ["trigger_paused", { screen: "builder", flowId: "f" }],
  ] as const)
    expect(parseNotice({ ...notice, kind, target })).toEqual({ ...notice, kind, target });
});

test("parseNotice refuses an extra key, a 300 character body, an unknown kind, a screen that is not allowed, a target id with a slash, a title with a control character and a non-object", () => {
  for (const value of [
    { ...notice, extra: true },
    { ...notice, body: "x".repeat(300) },
    { ...notice, kind: "other" },
    { ...notice, target: { screen: "settings" } },
    { ...notice, target: { screen: "run", runId: "a/b" } },
    { ...notice, title: `x${String.fromCodePoint(1)}` },
    null,
    { ...notice, target: { screen: "inbox", extra: true } },
  ])
    expect(parseNotice(value)).toBeUndefined();
});

test("hashFor gives the route of each target and encodes the colon of a weekly item", () => {
  expect(hashFor({ screen: "inbox" })).toBe("/inbox");
  expect(hashFor({ screen: "inbox", approvalId: "weekly-limit:claude-code" })).toBe(
    "/inbox/weekly-limit%3Aclaude-code",
  );
  expect(hashFor({ screen: "run", runId: "r" })).toBe("/runs/r");
  expect(hashFor({ screen: "builder", flowId: "f" })).toBe("/builder/f");
});

test("the handler shows a valid notice once per id and ignores an invalid one", () => {
  const show = vi.fn();
  const handle = createNoticeHandler({ show, windowFocused: () => false, open: () => {} });
  handle(notice);
  handle(notice);
  handle({ ...notice, kind: "other" });
  expect(show).toHaveBeenCalledOnce();
  expect(show).toHaveBeenCalledWith({ title: notice.title, body: notice.body }, expect.any(Function));
  for (let i = 0; i < 200; i++) handle({ ...notice, id: `id${i}` });
  handle(notice);
  expect(show).toHaveBeenCalledTimes(202);
});

test("it shows nothing while a window is focused", () => {
  const show = vi.fn();
  const handle = createNoticeHandler({ show, windowFocused: () => true, open: () => {} });
  handle(notice);
  expect(show).not.toHaveBeenCalled();
});

test("a click opens the hash of the target", () => {
  const open = vi.fn();
  const handle = createNoticeHandler({ show: (_notice, click) => click(), windowFocused: () => false, open });
  handle(notice);
  expect(open).toHaveBeenCalledWith("/inbox/a%3A1");
});

test("a show that throws is swallowed and the next notice still shows", () => {
  const show = vi.fn().mockImplementationOnce(() => {
    throw new Error("failed");
  });
  const handle = createNoticeHandler({ show, windowFocused: () => false, open: () => {} });
  expect(() => handle(notice)).not.toThrow();
  handle({ ...notice, id: "two" });
  expect(show).toHaveBeenCalledTimes(2);
});

test("electronNoticeHandler does nothing when notifications are not supported, and keeps the notification alive until it is clicked", () => {
  class FakeNotification {
    static supported = false;
    static instances: FakeNotification[] = [];
    static isSupported() {
      return this.supported;
    }
    listeners: Record<string, () => void> = {};
    show = vi.fn();
    constructor(publicOptions: { title: string; body: string }) {
      expect(publicOptions).toEqual({ title: notice.title, body: notice.body });
      FakeNotification.instances.push(this);
    }
    on(event: "click" | "close", fn: () => void) {
      this.listeners[event] = fn;
      return this;
    }
  }
  const open = vi.fn();
  const handle = electronNoticeHandler({ Notification: FakeNotification, windows: () => [], open });
  handle(notice);
  expect(FakeNotification.instances).toHaveLength(0);
  FakeNotification.supported = true;
  handle(notice);
  const instance = FakeNotification.instances.at(0);
  expect(instance?.show).toHaveBeenCalledOnce();
  instance?.listeners.click?.();
  expect(open).toHaveBeenCalledWith("/inbox/a%3A1");
  instance?.listeners.close?.();
});
