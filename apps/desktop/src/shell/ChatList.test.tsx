import { screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { renderApp } from "../test/render";

test("TC-j20-03 groups chats into Today, Yesterday, and Earlier in the person's zone, newest first", async () => {
  const clock = () => Date.parse("2026-11-21T02:00:00.000Z");
  const makeChats = () => [
    {
      chat: {
        id: "c-bangkok-today",
        title: "Bangkok early",
        updatedAt: "2026-11-20T18:00:00.000Z",
        from: "person" as const,
        agent: "claude-code" as const,
        model: "sonnet-5.5",
        language: "en",
        waiting: false,
      },
      messages: [],
      more: false,
      turn: { state: "idle" as const, queued: 0 },
      composerText: "",
    },
    {
      chat: {
        id: "c-yesterday",
        title: "Friday chat",
        updatedAt: "2026-11-20T08:00:00.000Z",
        from: "person" as const,
        agent: "claude-code" as const,
        model: "sonnet-5.5",
        language: "en",
        waiting: false,
      },
      messages: [],
      more: false,
      turn: { state: "idle" as const, queued: 0 },
      composerText: "",
    },
    {
      chat: {
        id: "c-newest",
        title: "Saturday morning",
        updatedAt: "2026-11-21T01:00:00.000Z",
        from: "person" as const,
        agent: "claude-code" as const,
        model: "sonnet-5.5",
        language: "en",
        waiting: false,
      },
      messages: [],
      more: false,
      turn: { state: "idle" as const, queued: 0 },
      composerText: "",
    },
  ];

  const bangkokView = renderApp("#/chat", {
    scenario: "story-v2",
    now: clock,
    zone: "Asia/Bangkok",
    setup(client) {
      client.state.chats = makeChats();
    },
  });
  const navBkk = screen.getByRole("navigation", { name: "Main menu" });
  const scrollerBkk = navBkk.querySelector<HTMLElement>('[data-scroll="chats"]');
  expect(scrollerBkk).toBeTruthy();
  if (!scrollerBkk) throw new Error("Missing chat scroller");

  await within(scrollerBkk).findByText("Today");
  const todayGroup = within(scrollerBkk).getByRole("region", { name: "Today" });
  const yesterdayGroup = within(scrollerBkk).getByRole("region", { name: "Yesterday" });
  expect(
    within(todayGroup)
      .getAllByRole("link")
      .map((el) => el.textContent),
  ).toEqual(["Saturday morning", "Bangkok early"]);
  expect(
    within(yesterdayGroup)
      .getAllByRole("link")
      .map((el) => el.textContent),
  ).toEqual(["Friday chat"]);
  expect(within(scrollerBkk).queryByText("Earlier")).toBeNull();
  expect(scrollerBkk.contains(within(navBkk).getByRole("button", { name: "New chat" }))).toBe(false);
  expect(scrollerBkk.contains(within(navBkk).getByRole("link", { name: "Flows" }))).toBe(false);
  bangkokView.unmount();

  const utcView = renderApp("#/chat", {
    scenario: "story-v2",
    now: clock,
    zone: "UTC",
    setup(client) {
      client.state.chats = [
        ...makeChats(),
        {
          chat: {
            id: "c-earlier",
            title: "Older chat",
            updatedAt: "2026-11-18T10:00:00.000Z",
            from: "person" as const,
            agent: "claude-code" as const,
            model: "sonnet-5.5",
            language: "en",
            waiting: false,
          },
          messages: [],
          more: false,
          turn: { state: "idle" as const, queued: 0 },
          composerText: "",
        },
      ];
    },
  });
  const navUtc = screen.getByRole("navigation", { name: "Main menu" });
  const scrollerUtc = navUtc.querySelector<HTMLElement>('[data-scroll="chats"]');
  if (!scrollerUtc) throw new Error("Missing UTC chat scroller");
  await within(scrollerUtc).findByText("Today");
  expect(
    within(within(scrollerUtc).getByRole("region", { name: "Today" }))
      .getAllByRole("link")
      .map((el) => el.textContent),
  ).toEqual(["Saturday morning"]);
  expect(
    within(within(scrollerUtc).getByRole("region", { name: "Yesterday" }))
      .getAllByRole("link")
      .map((el) => el.textContent),
  ).toEqual(["Bangkok early", "Friday chat"]);
  expect(
    within(within(scrollerUtc).getByRole("region", { name: "Earlier" }))
      .getAllByRole("link")
      .map((el) => el.textContent),
  ).toEqual(["Older chat"]);
  utcView.unmount();
});

test("TC-UI-25 only the chat list scrolls, every chat is listed, and empty groups are omitted", async () => {
  const nowMs = Date.parse("2026-11-20T03:00:00.000Z");
  renderApp("#/chat", {
    scenario: "story-v2",
    now: () => nowMs,
    zone: "UTC",
    setup(client) {
      client.state.chats = Array.from({ length: 30 }, (_, index) => ({
        chat: {
          id: `c-day-${index + 1}`,
          title: `Chat ${index + 1}`,
          updatedAt: new Date(nowMs - index * 60_000).toISOString(),
          from: "person" as const,
          agent: "claude-code" as const,
          model: "sonnet-5.5",
          language: "en",
          waiting: false,
        },
        messages: [],
        more: false,
        turn: { state: "idle" as const, queued: 0 },
        composerText: "",
      }));
    },
  });

  const nav = screen.getByRole("navigation", { name: "Main menu" });
  const scrollables = nav.querySelectorAll<HTMLElement>('[data-scroll="chats"]');
  expect(scrollables).toHaveLength(1);
  const scroller = scrollables[0];
  if (!scroller) throw new Error("Missing chat scroller");

  await waitFor(() => expect(within(scroller).getAllByRole("listitem")).toHaveLength(30));
  expect(within(scroller).queryByText("Yesterday")).toBeNull();
  expect(within(scroller).queryByText("Earlier")).toBeNull();
  for (const label of ["New chat", "Search", "Flows", "Activity", "Skills", "Settings"]) {
    const control =
      within(nav).queryByRole("button", { name: new RegExp(`^${label}`) }) ??
      within(nav).queryByRole("link", { name: new RegExp(`^${label}`) });
    expect(control, label).toBeTruthy();
    if (control) expect(scroller.contains(control), label).toBe(false);
  }
});

test("TC-UI-26 marks the open chat as current and renders a long HTML-like title as literal text", async () => {
  const fullTitle = `<i>Invoice</i> ${"x".repeat(185)}`;
  expect(fullTitle).toHaveLength(200);
  renderApp("#/chat/c-outside", {
    scenario: "story-v2",
    now: () => Date.parse("2026-11-20T03:00:00.000Z"),
    zone: "UTC",
    setup(client) {
      const target = client.state.chats.find((c) => c.chat.id === "c-outside");
      if (!target) throw new Error("Missing c-outside");
      target.chat.title = fullTitle;
    },
  });

  const nav = screen.getByRole("navigation", { name: "Main menu" });
  const link = await within(nav).findByRole("link", { name: fullTitle });
  expect(link.getAttribute("href")).toBe("#/chat/c-outside");
  expect(link.getAttribute("aria-current")).toBe("page");
  expect(link.textContent).toBe(fullTitle);
  expect(link.querySelector("i")).toBeNull();
  expect(link.getAttribute("title")).toBe(fullTitle);
  const currentItems = document.querySelectorAll('[aria-current="page"]');
  expect(currentItems).toHaveLength(1);
  expect(currentItems[0]).toBe(link);
});
