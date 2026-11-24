import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { type MorePreferenceStorage, renderApp, renderAppBoth, type SecondaryNavItem } from "../test/render";

function withNavigatorLanguage<T>(value: string, fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(navigator, "language");
  Object.defineProperty(navigator, "language", { value, configurable: true });
  try {
    return fn();
  } finally {
    if (original) Object.defineProperty(navigator, "language", original);
    else Reflect.deleteProperty(navigator, "language");
  }
}

function withMatchMedia(matcher: (query: string) => boolean, fn: () => void): void {
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: matcher(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  try {
    fn();
  } finally {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: original });
  }
}

function memoryStorage(): MorePreferenceStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

test("TC-UI-23 lists the V1 menu in order and marks the current page", () => {
  const first = renderApp("#/flows", { scenario: "story-v2" });
  const nav1 = screen.getByRole("navigation", { name: "Main menu" });
  const items1 = Array.from(nav1.querySelectorAll<HTMLElement>('[data-rail-item="true"]'));
  expect(items1.map((el) => el.textContent?.trim())).toEqual([
    "New chat",
    "Search",
    "Flows",
    "Activity",
    "Skills",
    "Settings",
  ]);
  expect(within(nav1).queryByText("Memory")).toBeNull();
  expect(within(nav1).queryByText("Marketplace")).toBeNull();
  expect(within(nav1).queryByText("Phone & bots")).toBeNull();
  expect(nav1.textContent).not.toMatch(/Coming later/i);
  const current1 = nav1.querySelectorAll('[aria-current="page"]');
  expect(current1).toHaveLength(1);
  expect(current1[0]?.textContent?.trim()).toBe("Flows");
  first.unmount();

  renderApp("#/settings", { scenario: "story-v2" });
  const nav2 = screen.getByRole("navigation", { name: "Main menu" });
  const current2 = nav2.querySelectorAll('[aria-current="page"]');
  expect(current2).toHaveLength(1);
  expect(current2[0]?.textContent?.trim()).toBe("Settings");
});

test("TC-UI-24 shows the Activity count from decisions plus waiting questions and updates on activity events", async () => {
  const zero = renderApp("#/flows", {
    scenario: "story-v2",
    setup(client) {
      client.state.decisions = [];
    },
  });
  const nav0 = screen.getByRole("navigation", { name: "Main menu" });
  await waitFor(() => {
    const link = within(nav0).getByRole("link", { name: "Activity" });
    expect(link.textContent?.trim()).toBe("Activity");
  });
  zero.unmount();

  const one = renderApp("#/flows", { scenario: "story-v2" });
  const nav1 = screen.getByRole("navigation", { name: "Main menu" });
  const activity1 = await within(nav1).findByRole("link", { name: "Activity 1" });
  expect(activity1.textContent).toContain("1");
  one.unmount();

  const twelve = renderApp("#/flows", {
    scenario: "story-v2",
    setup(client) {
      const baseDecision = client.state.decisions[0];
      if (!baseDecision) throw new Error("Missing sample decision");
      client.state.decisions.push({
        ...structuredClone(baseDecision),
        id: "decision-2",
        summary: "Second pending decision",
      });
      client.state.chats.push({
        chat: {
          id: "c-questions",
          title: "Scheduled questions",
          updatedAt: "2026-11-20T03:00:00.000Z",
          from: "flowdriven",
          agent: "claude-code",
          model: "sonnet-5.5",
          language: "en",
          waiting: true,
        },
        messages: Array.from({ length: 10 }, (_, idx) => ({
          id: `question-${idx + 1}`,
          seq: idx,
          at: "2026-11-20T03:00:00.000Z",
          role: "flowdriven" as const,
          kind: "card" as const,
          outside: false,
          card: {
            type: "inputs_ask" as const,
            state: "open" as const,
            flowId: "example.fill-timesheet",
            name: "Fill timesheet",
            questionId: `question-${idx + 1}`,
            missing: [{ inputId: "duration", label: "Duration" }],
            known: [],
            canUseLast: false,
          },
        })),
        more: false,
        turn: { state: "idle", queued: 0 },
        composerText: "",
      });
    },
  });
  const nav12 = screen.getByRole("navigation", { name: "Main menu" });
  const activity12 = await within(nav12).findByRole("link", { name: "Activity 12" });
  expect(activity12.textContent).toContain("12");

  const firstDecision = twelve.client.state.decisions[0];
  if (!firstDecision) throw new Error("Missing first decision");
  firstDecision.state = "approved";
  act(() => {
    twelve.client.emit({ type: "changed", topics: ["activity"] });
  });
  await within(nav12).findByRole("link", { name: "Activity 11" });
});

test("TC-UI-27 New chat calls chats.create {} once and routes to the returned chatId", async () => {
  const reusedView = renderApp("#/flows", { scenario: "story-v2" });
  const navReused = screen.getByRole("navigation", { name: "Main menu" });
  fireEvent.click(within(navReused).getByRole("button", { name: "New chat" }));
  await waitFor(() => expect(window.location.hash).toBe("#/chat/c-empty"));
  expect(reusedView.client.calls.filter((call) => call.operation === "chats.create")).toEqual([
    { operation: "chats.create", input: {} },
  ]);
  reusedView.unmount();

  const createdView = renderApp("#/flows", {
    scenario: "story-v2",
    setup(client) {
      client.state.chats = client.state.chats.filter((entry) => entry.messages.length > 0);
    },
  });
  const navCreated = screen.getByRole("navigation", { name: "Main menu" });
  fireEvent.click(within(navCreated).getByRole("button", { name: "New chat" }));
  await waitFor(() => expect(window.location.hash).toBe("#/chat/chat-fixture-1"));
  expect(createdView.client.calls.filter((call) => call.operation === "chats.create")).toEqual([
    { operation: "chats.create", input: {} },
  ]);
});

test("TC-UI-30 no rail item leads to an old route", () => {
  renderApp("#/flows", { scenario: "story-v2" });
  const nav = screen.getByRole("navigation", { name: "Main menu" });
  const oldPattern = /^#\/(builder|inbox|runs|readiness|harnesses)(\/|$)/;
  const links = within(nav).getAllByRole("link");
  for (const link of links) {
    expect(link.getAttribute("href") ?? "").not.toMatch(oldPattern);
  }
  for (const legacyLabel of ["New flow", "Inbox", "Runs", "Readiness", "Harnesses", "Builder"]) {
    expect(within(nav).queryByRole("link", { name: legacyLabel })).toBeNull();
    expect(within(nav).queryByRole("button", { name: legacyLabel })).toBeNull();
  }
});

test("TC-j30-02 renders the six rail words in English regardless of navigator.language", () => {
  withNavigatorLanguage("id-ID", () => {
    const enView = renderApp("#/settings", { scenario: "story-v2" });
    expect(document.documentElement.lang).toBe("en");
    const nav = screen.getByRole("navigation", { name: "Main menu" });
    expect(within(nav).getByRole("button", { name: "New chat" })).toBeTruthy();
    expect(within(nav).getByRole("button", { name: "Search" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Flows" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: /^Activity/ })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Skills" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(within(nav).queryByText("Memory")).toBeNull();
    expect(within(nav).queryByText("Marketplace")).toBeNull();
    expect(within(nav).queryByText("Phone & bots")).toBeNull();
    enView.unmount();
  });
});

test("TC-UI-32 More preserves navigation, order, focus, attention, preference, and drawer parity", async () => {
  await renderAppBoth("#/flows", { scenario: "story-v2" }, ({ language }) => {
    const nav = screen.getByRole("navigation", { name: language === "en" ? "Main menu" : "Menu utama" });
    expect(within(nav).getByRole("link", { name: language === "en" ? "Skills" : "Skill" })).toBeTruthy();
    expect(
      within(nav).queryByRole("button", {
        name: language === "en" ? /Show more/ : /Tampilkan lainnya/,
      }),
    ).toBeNull();
  });

  const laterItems: SecondaryNavItem[] = [
    { id: "phone", href: "#/phone", needsYou: true },
    { id: "marketplace", href: "#/marketplace" },
    { id: "memory", href: "#/memory", current: true },
    { id: "skills", href: "#/skills" },
  ];

  await renderAppBoth("#/flows", { scenario: "story-v2" }, ({ language, unmount }) => {
    const storage = memoryStorage();
    unmount();

    const labels =
      language === "en"
        ? {
            nav: "Main menu",
            showMore: "Show more",
            showLess: "Show less",
            needsYou: "Something here needs you",
            ordered: ["Skills", "Memory", "Marketplace", "Phone & bots"],
            memory: "Memory",
            phone: "Phone & bots",
            settings: "Settings",
            menu: "Menu",
          }
        : {
            nav: "Menu utama",
            showMore: "Tampilkan lainnya",
            showLess: "Tampilkan lebih sedikit",
            needsYou: "Ada yang perlu Anda di sini",
            ordered: ["Skill", "Memori", "Toko flow", "HP & bot"],
            memory: "Memori",
            phone: "HP & bot",
            settings: "Pengaturan",
            menu: "Menu",
          };

    const view1 = renderApp("#/flows", {
      scenario: "story-v2",
      language,
      secondaryItems: laterItems,
      moreStorage: storage,
    });
    const nav1 = screen.getByRole("navigation", { name: labels.nav });
    const moreBtn1 = within(nav1).getByRole("button", { name: new RegExp(labels.showMore) });
    expect(moreBtn1.getAttribute("aria-expanded")).toBe("false");
    const controlsId = moreBtn1.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    expect(controlsId ? document.getElementById(controlsId) : null).toBeTruthy();
    expect(moreBtn1.querySelector("svg")).toBeTruthy();
    expect(moreBtn1.textContent).toContain(labels.needsYou);
    expect(moreBtn1.getAttribute("title")).toBe(labels.needsYou);

    const visibleCurrent = within(nav1).getByRole("link", { name: labels.memory });
    expect(visibleCurrent.getAttribute("aria-current")).toBe("page");
    expect(within(nav1).queryByRole("link", { name: labels.ordered[0] })).toBeNull();
    expect(within(nav1).queryByRole("link", { name: labels.ordered[2] })).toBeNull();
    expect(within(nav1).queryByRole("link", { name: new RegExp(labels.phone) })).toBeNull();

    moreBtn1.focus();
    fireEvent.keyDown(moreBtn1, { key: "Enter" });
    expect(moreBtn1.getAttribute("aria-expanded")).toBe("true");
    expect(moreBtn1.textContent).toContain(labels.showLess);
    expect(moreBtn1.textContent).not.toContain(labels.needsYou);
    expect(document.activeElement).toBe(moreBtn1);

    const container = controlsId ? document.getElementById(controlsId) : null;
    expect(container).toBeTruthy();
    if (!container) throw new Error("Missing aria-controls container");
    const expandedLinks = within(container).getAllByRole("link");
    expect(expandedLinks.map((link) => link.textContent?.replace(labels.needsYou, "").trim())).toEqual(
      labels.ordered,
    );
    expect(within(container).getByRole("link", { name: labels.memory }).getAttribute("aria-current")).toBe(
      "page",
    );
    const phoneLink = within(container).getByRole("link", { name: new RegExp(labels.phone) });
    expect(phoneLink.textContent).toContain(labels.needsYou);
    expect(phoneLink.querySelector("svg")).toBeTruthy();

    const scroller = nav1.querySelector<HTMLElement>('[data-scroll="chats"]');
    const settingsLink = within(nav1).getByRole("link", { name: labels.settings });
    expect(scroller).toBeTruthy();
    if (scroller) {
      expect(scroller.contains(settingsLink)).toBe(false);
      expect(Boolean(scroller.compareDocumentPosition(settingsLink) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
        true,
      );
    }
    view1.unmount();

    const view2 = renderApp("#/flows", {
      scenario: "story-v2",
      language,
      secondaryItems: laterItems,
      moreStorage: storage,
    });
    const nav2 = screen.getByRole("navigation", { name: labels.nav });
    const moreBtn2 = within(nav2).getByRole("button", { name: new RegExp(labels.showLess) });
    expect(moreBtn2.getAttribute("aria-expanded")).toBe("true");
    moreBtn2.focus();
    fireEvent.keyDown(moreBtn2, { key: " " });
    expect(moreBtn2.getAttribute("aria-expanded")).toBe("false");
    expect(moreBtn2.textContent).toContain(labels.showMore);
    expect(document.activeElement).toBe(moreBtn2);
    view2.unmount();

    const brokenStorage: MorePreferenceStorage = {
      getItem: () => {
        throw new Error("storage read failed");
      },
      setItem: () => {
        throw new Error("storage write failed");
      },
    };
    const view3 = renderApp("#/flows", {
      scenario: "story-v2",
      language,
      secondaryItems: laterItems,
      moreStorage: brokenStorage,
    });
    const nav3 = screen.getByRole("navigation", { name: labels.nav });
    const moreBtn3 = within(nav3).getByRole("button", { name: new RegExp(labels.showMore) });
    expect(moreBtn3.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(moreBtn3);
    expect(moreBtn3.getAttribute("aria-expanded")).toBe("true");
    view3.unmount();

    withMatchMedia(
      (query) => query.includes("767px"),
      () => {
        const narrowView = renderApp("#/flows", {
          scenario: "story-v2",
          language,
          secondaryItems: laterItems,
          moreStorage: memoryStorage(),
        });
        fireEvent.click(screen.getByRole("button", { name: labels.menu }));
        const drawerNav = screen.getByRole("navigation", { name: labels.nav });
        const drawerMore = within(drawerNav).getByRole("button", { name: new RegExp(labels.showMore) });
        expect(drawerMore.getAttribute("aria-expanded")).toBe("false");
        expect(drawerMore.textContent).toContain(labels.needsYou);
        expect(
          within(drawerNav).getByRole("link", { name: labels.memory }).getAttribute("aria-current"),
        ).toBe("page");
        fireEvent.click(drawerMore);
        expect(drawerMore.getAttribute("aria-expanded")).toBe("true");
        expect(drawerMore.textContent).toContain(labels.showLess);
        narrowView.unmount();
      },
    );
  });
});
