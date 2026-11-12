const prefix = "mcp__claude-in-chrome__";
export const chromeTools = [
  "browser_batch",
  "computer",
  "file_upload",
  "find",
  "form_input",
  "get_page_text",
  "gif_creator",
  "list_connected_browsers",
  "navigate",
  "read_console_messages",
  "read_network_requests",
  "read_page",
  "resize_window",
  "select_browser",
  "shortcuts_execute",
  "shortcuts_list",
  "switch_browser",
  "tabs_close_mcp",
  "tabs_context_mcp",
  "tabs_create_mcp",
  "upload_image",
].map((name) => prefix + name);
type Pages = Record<string, { final?: string; title: string; text: string }>;
type Block = { type: "text"; text: string };
export class FakeChrome {
  private tabs = new Map<number, string | undefined>();
  private next = 1002;
  result(name: string, input: Record<string, unknown>, pages: Pages): { blocks: Block[]; error?: string } {
    const tool = name.startsWith(prefix) ? name.slice(prefix.length) : name;
    let id = typeof input.tabId === "number" ? input.tabId : -1;
    if (tool === "tabs_context_mcp" || tool === "tabs_create_mcp") id = 1001;
    let text = "ok";
    const noPage =
      "Couldn't determine which page this action targets. Re-read tabs_context_mcp and try again.";
    if (tool === "tabs_context_mcp") {
      if (!this.tabs.size) this.tabs.set(1001, undefined);
      text = JSON.stringify({
        availableTabs: [...this.tabs].map(([tabId, url]) => ({
          tabId,
          title: url ? (pages[url]?.title ?? "Not found") : "New Tab",
          url: url ?? "chrome://newtab/",
        })),
        tabGroupId: 2146784031,
      });
    } else if (tool === "tabs_create_mcp") {
      if (!this.tabs.size)
        return {
          blocks: [],
          error:
            "This session has no tab group of its own. Call tabs_context_mcp with createIfEmpty: true first",
        };
      id = this.next++;
      this.tabs.set(id, undefined);
      text = `Created new tab. Tab ID: ${id}`;
    } else if (tool === "tabs_close_mcp") {
      if (!this.tabs.has(id))
        return {
          blocks: [],
          error: `Tab ${id} is not in Claude's tab group for this session. Tools can only target tabs inside the group. Call tabs_context_mcp to list valid tabs (or create the group with createIfEmpty: true), or tabs_create_mcp to add a tab.`,
        };
      this.tabs.delete(id);
      text = `Closed tab ${id}. Group is now empty (auto-removed).`;
    } else if (tool === "navigate") {
      if (!this.tabs.has(id) || typeof input.url !== "string") return { blocks: [], error: noPage };
      this.tabs.set(id, input.url);
      text = `Navigated to ${input.url}`;
    } else if (tool === "get_page_text") {
      const url = this.tabs.get(id);
      if (!url) return { blocks: [], error: noPage };
      const page = pages[url] ?? { title: "Not found", text: "Nothing here." };
      text = `Title: ${page.title}\nURL: ${page.final ?? url}\nSource element: <body>\n---\n${page.text}`;
    }
    return {
      blocks: [
        { type: "text", text },
        {
          type: "text",
          text: `\n\nTab Context:\n- Executed on tabId: ${id}\n- Available tabs: ${[...this.tabs.keys()].join(", ")}`,
        },
        {
          type: "text",
          text: "<system-reminder>You used a single tool call this turn. Prefer browser_batch ...</system-reminder>",
        },
      ],
    };
  }
}
