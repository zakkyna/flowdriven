import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { renderApp, renderAppBoth } from "../test/render";

function withMatchMedia(matcher: (query: string) => boolean, fn: () => void | Promise<void>): Promise<void> {
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
  return Promise.resolve(fn()).finally(() => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: original });
  });
}

test("TC-UI-31 opens with Cmd or Ctrl+K, shows chats and flows in groups with outside marks, opens chosen results, and Escape returns focus", async () => {
  await renderAppBoth("#/chat", { scenario: "story-v2" }, async ({ language, client }) => {
    expect(client.state.chats).toHaveLength(6);
    expect(client.state.flows).toHaveLength(5);
    expect(
      client.state.chats.flatMap((entry) => entry.messages).filter((message) => message.outside),
    ).toHaveLength(1);

    const labels =
      language === "en"
        ? {
            nav: "Main menu",
            search: "Search",
            placeholder: "Search chats and flows",
            recentChats: "Recent chats",
            chats: "Chats",
            flows: "Flows",
            settings: "Settings",
            outsideTag: "Includes text from an email or web page",
            noResults: (q: string) => `Nothing found for "${q}".`,
          }
        : {
            nav: "Menu utama",
            search: "Cari",
            placeholder: "Cari chat dan flow",
            recentChats: "Chat terbaru",
            chats: "Chat",
            flows: "Flow",
            settings: "Pengaturan",
            outsideTag: "Berisi teks dari email atau halaman web",
            noResults: (q: string) => `Tidak ada hasil untuk "${q}".`,
          };

    fireEvent.keyDown(document, { key: "k", metaKey: true });
    const dialog = screen.getByRole("dialog", { name: labels.search });
    const input = within(dialog).getByRole("combobox", { name: labels.placeholder });
    expect(document.activeElement).toBe(input);

    await waitFor(() => {
      expect(client.calls).toContainEqual({ operation: "search.query", input: { text: "" } });
    });

    const recentGroup = await within(dialog).findByRole("group", { name: labels.recentChats });
    expect(within(recentGroup).getAllByRole("option")).toHaveLength(5);
    expect(within(recentGroup).queryByText("Archive notes")).toBeNull();

    const initialFlowsGroup = within(dialog).getByRole("group", { name: labels.flows });
    expect(
      within(initialFlowsGroup)
        .getAllByRole("option")
        .map((el) => el.textContent),
    ).toEqual([
      "Build APK and upload it",
      "Email triage",
      "Fill timesheet",
      "Job review",
      "Weekly supplier report",
    ]);

    fireEvent.change(input, { target: { value: "timesheet" } });
    await waitFor(() => {
      expect(client.calls).toContainEqual({ operation: "search.query", input: { text: "timesheet" } });
    });

    const chatsGroup = await within(dialog).findByRole("group", { name: labels.chats });
    const chatOptions = within(chatsGroup).getAllByRole("option");
    expect(chatOptions).toHaveLength(2);
    expect(chatOptions[0]?.textContent).toContain("Fill timesheet");
    expect(chatOptions[0]?.querySelector('[data-outside-tag="true"]')).toBeNull();
    expect(chatOptions[1]?.textContent).toContain("Invoice follow-up");
    expect(chatOptions[1]?.textContent).toContain("Received invoice and timesheet update from supplier.");
    const outsideTag = chatOptions[1]?.querySelector('[data-outside-tag="true"]');
    expect(outsideTag?.textContent).toBe(labels.outsideTag);

    const flowsGroup = within(dialog).getByRole("group", { name: labels.flows });
    const flowOptions = within(flowsGroup).getAllByRole("option");
    expect(flowOptions).toHaveLength(1);
    expect(flowOptions[0]?.textContent).toContain("Fill timesheet");

    expect(chatOptions[0]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(chatOptions[1]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(flowOptions[0]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.location.hash).toBe("#/flows/example.fill-timesheet");

    const nav = screen.getByRole("navigation", { name: labels.nav });
    const settingsLink = within(nav).getByRole("link", { name: labels.settings });
    settingsLink.focus();
    expect(document.activeElement).toBe(settingsLink);

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const secondDialog = screen.getByRole("dialog", { name: labels.search });
    const secondInput = within(secondDialog).getByRole("combobox", { name: labels.placeholder });
    expect(document.activeElement).toBe(secondInput);

    fireEvent.keyDown(secondInput, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(settingsLink);

    fireEvent.click(within(nav).getByRole("button", { name: labels.search }));
    const railDialog = screen.getByRole("dialog", { name: labels.search });
    const railInput = within(railDialog).getByRole("combobox", { name: labels.placeholder });
    fireEvent.change(railInput, { target: { value: "timesheet" } });
    await within(railDialog).findByRole("group", { name: labels.chats });
    fireEvent.keyDown(railInput, { key: "Enter" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.location.hash).toBe("#/chat/c1");

    fireEvent.keyDown(document, { key: "k", metaKey: true });
    const emptyDialog = screen.getByRole("dialog", { name: labels.search });
    const emptyInput = within(emptyDialog).getByRole("combobox", { name: labels.placeholder });
    fireEvent.change(emptyInput, { target: { value: "zzzzqq" } });
    await within(emptyDialog).findByText(labels.noResults("zzzzqq"));
    fireEvent.keyDown(emptyInput, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

test("TC-UI-31 draws outside snippets with SafeText, keeps titles plain text, skips Cmd+K over another dialog, and opens from Drawer", async () => {
  const hiddenChar = String.fromCodePoint(0x200b);
  const view = renderApp("#/chat", {
    scenario: "story-v2",
    setup(client) {
      const outsideChat = client.state.chats.find((c) => c.chat.id === "c-outside");
      if (!outsideChat) throw new Error("Missing c-outside");
      outsideChat.chat.title = "<i>Invoice</i> timesheet";
      const outsideMsg = outsideChat.messages[0];
      if (!outsideMsg) throw new Error("Missing c-outside message");
      outsideMsg.text = `See <b>timesheet</b>${hiddenChar} update`;
    },
  });

  fireEvent.keyDown(document, { key: "k", metaKey: true });
  const dialog = screen.getByRole("dialog", { name: "Search" });
  const input = within(dialog).getByRole("combobox", { name: "Search chats and flows" });
  fireEvent.change(input, { target: { value: "timesheet" } });

  const chatsGroup = await within(dialog).findByRole("group", { name: "Chats" });
  const outsideOption = within(chatsGroup)
    .getAllByRole("option")
    .find((option) => option.textContent?.includes("<i>Invoice</i> timesheet"));
  expect(outsideOption).toBeTruthy();
  if (!outsideOption) throw new Error("Missing outside option");
  expect(outsideOption.querySelector("i")).toBeNull();
  expect(outsideOption.querySelector("b")).toBeNull();
  expect(outsideOption.textContent).toContain("[U+200B hidden character]");
  expect(outsideOption.textContent).toContain("<b>timesheet</b>");
  expect(outsideOption.querySelectorAll('[data-outside-tag="true"]')).toHaveLength(1);

  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();

  const otherDialog = document.createElement("div");
  otherDialog.setAttribute("role", "dialog");
  otherDialog.setAttribute("aria-label", "Other");
  document.body.appendChild(otherDialog);
  fireEvent.keyDown(document, { key: "k", metaKey: true });
  expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
  otherDialog.remove();
  view.unmount();

  await withMatchMedia(
    (query) => query.includes("767px"),
    async () => {
      renderApp("#/chat", { scenario: "story-v2" });
      const menuButton = screen.getByRole("button", { name: "Menu" });
      fireEvent.click(menuButton);
      const drawer = screen.getByRole("dialog", { name: "Menu" });
      fireEvent.click(within(drawer).getByRole("button", { name: "Search" }));
      expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
      const searchDialog = screen.getByRole("dialog", { name: "Search" });
      const searchInput = within(searchDialog).getByRole("combobox", { name: "Search chats and flows" });
      fireEvent.keyDown(searchInput, { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
      expect(document.activeElement).toBe(menuButton);
    },
  );
});
