import { matchTemplate, type UrlTemplate } from "@flowdriven/sdk";

export const CHROME_PREFIX = "mcp__claude-in-chrome__";
export const MAX_PAGE_CHARS = 40_000;
export const MAX_TABS_OPENED = 2;
export const BROWSER_DENY = {
  readOnly: "This step may only read pages.",
  address: "This address is not one this step declares.",
  runLimit: "This step reached its page limit for this run.",
  dayLimit: "This flow reached its page limit for today.",
  part: "This browser call has a part FlowDriven does not recognise.",
  tab: "This tab is not one this step opened.",
  tabs: "This step opened too many tabs.",
};
export type BrowserPolicy = {
  requirementId: string;
  templates: UrlTemplate[];
  perRun: number;
  perDay: number;
};
export type PageCounts = { run: number; day: number };
export type BrowserState = { counts: PageCounts; tabs: ReadonlySet<number>; opened: number };
export function decideBrowser(
  browser: BrowserPolicy,
  name: string,
  input: Record<string, unknown>,
  state: BrowserState,
): { allow: true; effect?: "page" | "tab" } | { allow: false; reason: string; target?: string } {
  const deny = (reason: string) => ({ allow: false as const, reason });
  const keys = Object.keys(input);
  const only = (...allowed: string[]) => keys.every((key) => allowed.includes(key));
  if (name === "tabs_context_mcp") {
    if (!only("createIfEmpty") || ("createIfEmpty" in input && input.createIfEmpty !== true))
      return deny(BROWSER_DENY.part);
    return { allow: true };
  }
  if (name === "tabs_create_mcp") {
    if (keys.length !== 0) return deny(BROWSER_DENY.part);
    return !(Number.isSafeInteger(state.opened) && state.opened >= 0) || state.opened >= MAX_TABS_OPENED
      ? deny(BROWSER_DENY.tabs)
      : { allow: true, effect: "tab" };
  }
  if (name !== "navigate" && name !== "get_page_text" && name !== "tabs_close_mcp")
    return deny(BROWSER_DENY.readOnly);
  if (
    !only(
      ...(name === "navigate"
        ? ["tabId", "url"]
        : name === "get_page_text"
          ? ["tabId", "max_chars"]
          : ["tabId"]),
    ) ||
    typeof input.tabId !== "number" ||
    !Number.isSafeInteger(input.tabId) ||
    (name === "navigate" && typeof input.url !== "string") ||
    (name === "get_page_text" &&
      "max_chars" in input &&
      (typeof input.max_chars !== "number" ||
        !Number.isSafeInteger(input.max_chars) ||
        input.max_chars <= 0 ||
        input.max_chars > MAX_PAGE_CHARS))
  )
    return deny(BROWSER_DENY.part);
  if (!state.tabs.has(input.tabId)) return deny(BROWSER_DENY.tab);
  if (name === "navigate") {
    if (typeof input.url !== "string") return deny(BROWSER_DENY.part);
    if (!browser.templates.some((template) => matchTemplate(template, input.url as string) !== undefined))
      return { ...deny(BROWSER_DENY.address), target: input.url.slice(0, 300) };
    if (
      !(Number.isSafeInteger(state.counts.run) && state.counts.run >= 0) ||
      state.counts.run >= browser.perRun
    )
      return deny(BROWSER_DENY.runLimit);
    if (
      !(Number.isSafeInteger(state.counts.day) && state.counts.day >= 0) ||
      state.counts.day >= browser.perDay
    )
      return deny(BROWSER_DENY.dayLimit);
    return { allow: true, effect: "page" };
  }
  return { allow: true };
}
