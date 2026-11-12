import { matchTemplate } from "@flowdriven/sdk";
import { type BrowserPolicy, CHROME_PREFIX, MAX_PAGE_CHARS } from "./browser.ts";
import { visible } from "./text.ts";

export { MAX_PAGE_CHARS } from "./browser.ts";
export const MAX_PAGE_BYTES = 40_000;
export const POST_TEXT = {
  moved: "FlowDriven withheld this page because its address is not one this step declares.",
  challenge: "FlowDriven withheld this page because the site asked for a login or a robot check.",
  unchecked: "FlowDriven withheld this result because it could not check it.",
  cut: "[cut by FlowDriven]",
};
export const STOP = {
  moved: "The page moved to an address this step does not declare.",
  challenge: "This site asked for a login or a robot check. FlowDriven stopped and will not try to pass it.",
  chromeDown: "Chrome is not connected to Claude Code.",
};
export type PostResult = {
  kind: "pass" | "cut" | "unchecked" | "moved" | "challenge";
  text: string;
  tool: string;
  address?: string;
  tabs?: number[];
};
function object(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
export function cutText(text: string): { text: string; cut: boolean } {
  let kept = "";
  let bytes = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char, "utf8");
    if (kept.length + char.length > MAX_PAGE_CHARS || bytes + size > MAX_PAGE_BYTES)
      return { text: `${kept}\n${POST_TEXT.cut}`, cut: true };
    kept += char;
    bytes += size;
  }
  return { text: kept, cut: false };
}
export function decidePost(browser: BrowserPolicy, sessionId: string, call: unknown): PostResult | undefined {
  if (
    !object(call) ||
    call.hook_event_name !== "PostToolUse" ||
    call.session_id !== sessionId ||
    typeof call.tool_use_id !== "string" ||
    !object(call.tool_input) ||
    typeof call.tool_name !== "string" ||
    !call.tool_name.startsWith(CHROME_PREFIX)
  )
    return undefined;
  const name = call.tool_name.slice(CHROME_PREFIX.length);
  const tool = visible(name, 60);
  const unchecked = (): PostResult => ({ kind: "unchecked", text: POST_TEXT.unchecked, tool });
  if (!Array.isArray(call.tool_response)) return unchecked();
  const first: unknown = call.tool_response.at(0);
  if (!object(first) || first.type !== "text" || typeof first.text !== "string") return unchecked();
  const block = first.text;
  if (name === "tabs_context_mcp") {
    let value: unknown;
    try {
      value = JSON.parse(block);
    } catch {
      return unchecked();
    }
    if (!object(value) || !Array.isArray(value.availableTabs) || value.availableTabs.length > 50)
      return unchecked();
    const tabs: number[] = [];
    for (const tab of value.availableTabs as unknown[]) {
      if (!object(tab) || typeof tab.tabId !== "number" || !Number.isSafeInteger(tab.tabId) || tab.tabId < 0)
        return unchecked();
      tabs.push(tab.tabId);
    }
    return {
      kind: "pass",
      text: JSON.stringify({ availableTabs: tabs.map((tabId) => ({ tabId })) }),
      tool,
      tabs,
    };
  }
  if (name === "tabs_create_mcp") {
    const match = /^Created new tab\. Tab ID: (\d{1,16})$/.exec(block);
    if (!match?.[1]) return unchecked();
    const id = Number(match[1]);
    if (!Number.isSafeInteger(id)) return unchecked();
    return { kind: "pass", text: `Created new tab. Tab ID: ${id}`, tool, tabs: [id] };
  }
  if (name === "navigate") {
    if (!block.startsWith("Navigated to ") || typeof call.tool_input.url !== "string") return unchecked();
    return { kind: "pass", text: `Navigated to ${call.tool_input.url}`, tool };
  }
  if (name === "tabs_close_mcp") {
    if (
      !block.startsWith("Closed tab ") ||
      typeof call.tool_input.tabId !== "number" ||
      !Number.isSafeInteger(call.tool_input.tabId)
    )
      return unchecked();
    return { kind: "pass", text: `Closed tab ${call.tool_input.tabId}.`, tool };
  }
  if (name !== "get_page_text") return unchecked();
  const header =
    /^Title: ([^\r\n\u2028\u2029]*)\nURL: ([^\r\n\u2028\u2029]*)\nSource element: ([^\r\n\u2028\u2029]*)\n---(?:\n|$)/.exec(
      block,
    );
  if (!header || header[1] === undefined || header[2] === undefined) return unchecked();
  const title = header[1].toLowerCase();
  const address = header[2];
  const body = block.slice(header[0].length);
  const onTemplate = browser.templates.some((template) => matchTemplate(template, address) !== undefined);
  const titles = [
    "just a moment",
    "attention required",
    "access denied",
    "verify you are human",
    "security check",
    "log in",
    "sign in",
    "login",
  ];
  let pathname = "";
  try {
    pathname = new URL(address).pathname.toLowerCase();
  } catch {
    /* Invalid addresses remain off-template. */
  }
  const challenge = onTemplate
    ? body.length < 800 &&
      (titles.slice(0, 5).some((marker) => title.startsWith(marker)) ||
        ["verify you are human", "are you a robot", "unusual activity", "captcha"].some((marker) =>
          body.toLowerCase().includes(marker),
        ))
    : ["/login", "/signin", "/sign-in", "/checkpoint", "/challenge", "/captcha", "/account-security"].some(
        (marker) => pathname.includes(marker),
      ) || titles.some((marker) => title.startsWith(marker));
  if (challenge) return { kind: "challenge", text: POST_TEXT.challenge, tool };
  if (!onTemplate) return { kind: "moved", text: POST_TEXT.moved, tool, address };
  const result = cutText(block);
  return { kind: result.cut ? "cut" : "pass", text: result.text, tool };
}
export function postLine(text: string): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolUse", updatedMCPToolOutput: [{ type: "text", text }] },
  });
}
