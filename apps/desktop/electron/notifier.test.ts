import { expect, test, vi } from "vitest";
import { createNoticeHandler, electronNoticeHandler, hashFor, parseNotice } from "./notifier";

const notice = {
  id: "one",
  kind: "approval_waiting",
  title: { key: "notice.decisionTitle" },
  body: { key: "notice.decisionBody" },
  language: "en",
  target: { screen: "run", runId: "r", approvalId: "a:1" },
};

test("TC-ELE-21 parseNotice accepts fixed Lines and version 2 targets", () => {
  for (const target of [
    { screen: "run", runId: "r", approvalId: "a" },
    { screen: "chat", chatId: "c" },
    { screen: "flow", flowId: "f" },
    { screen: "activity" },
    { screen: "settings" },
  ])
    expect(parseNotice({ ...notice, target })).toEqual({ ...notice, target });
  for (const bad of [
    { ...notice, extra: true },
    { ...notice, title: "text" },
    { ...notice, title: { key: "notice.decisionTitle", params: {} } },
    { ...notice, kind: "other" },
    { ...notice, target: { screen: "inbox" } },
    { ...notice, target: { screen: "run", runId: "a/b" } },
    null,
  ])
    expect(parseNotice(bad)).toBeUndefined();
});
test("TC-ELE-23 hashFor gives version 2 routes", () => {
  expect(hashFor({ screen: "run", runId: "r" })).toBe("/activity/r");
  expect(hashFor({ screen: "chat", chatId: "c" })).toBe("/chat/c");
  expect(hashFor({ screen: "flow", flowId: "f" })).toBe("/flows/f");
  expect(hashFor({ screen: "activity" })).toBe("/activity");
  expect(hashFor({ screen: "settings" })).toBe("/settings");
});

test("the handler shows a valid notice once per id and ignores an invalid one", () => {
  const show = vi.fn();
  const handle = createNoticeHandler({ show, windowFocused: () => false, open: () => {} });
  handle(notice);
  handle(notice);
  handle({ ...notice, kind: "other" });
  expect(show).toHaveBeenCalledOnce();
  expect(show).toHaveBeenCalledWith(
    { title: "FlowDriven needs a decision", body: "Open FlowDriven to see what is waiting." },
    expect.any(Function),
  );
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
  expect(open).toHaveBeenCalledWith("/activity/r");
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
      expect(publicOptions).toEqual({
        title: "FlowDriven needs a decision",
        body: "Open FlowDriven to see what is waiting.",
      });
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
  expect(open).toHaveBeenCalledWith("/activity/r");
  instance?.listeners.close?.();
});

test("TC-j30-26 main draws question notices in their language", () => {
  const show = vi.fn();
  const handle = createNoticeHandler({
    show,
    windowFocused: () => false,
    open: () => {},
    words: (language, key) => `${language}:${key}`,
  });
  const question = {
    id: "q1",
    kind: "question_waiting",
    title: { key: "notice.questionTitle" },
    body: { key: "notice.questionBody" },
    language: "en",
    target: { screen: "chat", chatId: "c1" },
  };
  handle(question);
  handle({ ...question, id: "q2", language: "id" });
  expect(show.mock.calls.map(([value]) => value)).toEqual([
    { title: "en:notice.questionTitle", body: "en:notice.questionBody" },
    { title: "id:notice.questionTitle", body: "id:notice.questionBody" },
  ]);
});

test("TC-ELE-18 draws injected decision words", () => {
  const show = vi.fn();
  const handle = createNoticeHandler({
    show,
    windowFocused: () => false,
    open: () => {},
    words: (language, key) => `${language}:${key}`,
  });
  handle({
    id: "a1",
    kind: "approval_waiting",
    title: { key: "notice.decisionTitle" },
    body: { key: "notice.decisionBody" },
    language: "id",
    target: { screen: "run", runId: "r1" },
  });
  expect(show).toHaveBeenCalledWith(
    { title: "id:notice.decisionTitle", body: "id:notice.decisionBody" },
    expect.any(Function),
  );
});

test("TC-j30-26 TC-ELE-18 Electron draws the shared words in each notice language", async () => {
  const { fakeNotifier } = await import("./test-helpers/fakes");
  const { default: words } = await import("./notice-words.json");
  const drawn: { title: string; body: string }[] = [];
  const handle = electronNoticeHandler({
    Notification: fakeNotifier((value) => drawn.push(value)),
    windows: () => [],
    open: () => {},
  });
  for (const [index, language] of ["en", "id"].entries()) {
    handle({
      id: `q${index}`,
      kind: "question_waiting",
      title: { key: "notice.questionTitle" },
      body: { key: "notice.questionBody" },
      language,
      target: { screen: "chat", chatId: "c" },
    });
    handle({
      id: `a${index}`,
      kind: "approval_waiting",
      title: { key: "notice.decisionTitle" },
      body: { key: "notice.decisionBody" },
      language,
      target: { screen: "run", runId: "r" },
    });
  }
  expect(drawn).toEqual(
    [words.en, words.id].flatMap((entry) => [
      { title: entry.questionTitle, body: entry.questionBody },
      { title: entry.decisionTitle, body: entry.decisionBody },
    ]),
  );
});

test("TC-ELE-18 notifier source has no notification sentences and cuts long drawn words", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("apps/desktop/electron/notifier.ts", "utf8");
  expect(source).not.toContain("FlowDriven needs a decision");
  expect(source).not.toContain("Open FlowDriven to see what is waiting.");
  const show = vi.fn();
  const handle = createNoticeHandler({
    show,
    open: () => {},
    windowFocused: () => false,
    words: (_language, key) => "x".repeat(key.endsWith("Title") ? 100 : 300),
  });
  handle(notice);
  expect(show).toHaveBeenCalledWith(
    { title: `${"x".repeat(77)}...`, body: `${"x".repeat(237)}...` },
    expect.any(Function),
  );
});

test("TC-ELE-21 each notice kind has fixed keys and unknown languages fall back", () => {
  for (const [kind, family] of [
    ["approval_waiting", "decision"],
    ["run_blocked", "problem"],
    ["weekly_limit", "limit"],
    ["flood_cap", "limit"],
    ["trigger_paused", "limit"],
    ["question_waiting", "question"],
    ["confirm_waiting", "question"],
  ]) {
    const value = {
      ...notice,
      kind,
      title: { key: `notice.${family}Title` },
      body: { key: `notice.${family}Body` },
      language: "xx",
    };
    expect(parseNotice(value)).toMatchObject({ ...value, language: "en" });
    expect(parseNotice({ ...value, body: { key: "notice.wrongBody" } })).toBeUndefined();
    expect(parseNotice({ ...value, body: { key: `notice.${family}Body`, params: {} } })).toBeUndefined();
  }
});
