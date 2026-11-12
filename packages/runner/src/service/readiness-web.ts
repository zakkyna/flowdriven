import { join } from "node:path";

export const WEB_FIX = "Install the Claude extension in Chrome, then run `claude --chrome` once.";
export function nativeHostPath(home: string): string {
  return join(
    home,
    "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_code_browser_extension.json",
  );
}
export function webReadiness(i: { chromeFlag: boolean; hostFile: boolean }): {
  state: "ok" | "missing";
  detail: string;
} {
  return i.chromeFlag && i.hostFile
    ? {
        state: "ok",
        detail: "Claude Code can use Chrome and the extension is installed. Chrome itself must be open.",
      }
    : { state: "missing", detail: WEB_FIX };
}
