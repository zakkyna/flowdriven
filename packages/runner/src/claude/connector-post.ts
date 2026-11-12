import { cutText, POST_TEXT } from "./browser-post.ts";
import type { ConnectorPolicy } from "./connector.ts";
import { visible } from "./text.ts";

export type ConnectorPostResult = { kind: "pass" | "cut" | "unchecked"; text: string; tool: string };
function object(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
export function decideConnectorPost(
  connector: ConnectorPolicy,
  sessionId: string,
  call: unknown,
): ConnectorPostResult | undefined {
  if (
    !object(call) ||
    call.hook_event_name !== "PostToolUse" ||
    call.session_id !== sessionId ||
    typeof call.tool_use_id !== "string" ||
    typeof call.tool_name !== "string" ||
    !call.tool_name.startsWith(connector.prefix)
  )
    return undefined;
  const name = call.tool_name.slice(connector.prefix.length);
  const tool = visible(name, 60);
  const unchecked = (): ConnectorPostResult => ({ kind: "unchecked", text: POST_TEXT.unchecked, tool });
  if (!connector.tools.includes(name)) return unchecked();
  let text: string;
  if (typeof call.tool_response === "string") text = call.tool_response;
  else if (Array.isArray(call.tool_response) && call.tool_response.length > 0) {
    const blocks: string[] = [];
    for (const block of call.tool_response as unknown[]) {
      if (!object(block) || block.type !== "text" || typeof block.text !== "string") return unchecked();
      blocks.push(block.text);
    }
    text = blocks.join("\n");
  } else return unchecked();
  const result = cutText(text);
  return { kind: result.cut ? "cut" : "pass", text: result.text, tool };
}
