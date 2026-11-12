import { isAbsolute } from "node:path";
import { POST_TEXT, postLine } from "./browser-post.ts";

export const HOOK_TIMEOUT_SECONDS = 120;
export const POST_WITHHELD_LINE = postLine(POST_TEXT.unchecked);
export const ALLOW_JSON =
  '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"Declared by the flow."}}';

export function isSafeControlPath(path: string): boolean {
  return (
    isAbsolute(path) &&
    !path.includes("'") &&
    [...path].every((char) => {
      const point = char.codePointAt(0);
      return point !== undefined && point >= 0x20 && point !== 0x7f;
    })
  );
}

export function hookScript(options: { rounds: number }): string {
  if (!Number.isInteger(options.rounds) || options.rounds < 1 || options.rounds > 600) {
    throw new Error("The number of rounds is not valid.");
  }
  return [
    "PATH=/usr/bin:/bin",
    'if [ "$1" = "post" ]; then',
    `  withheld() { printf '%s\\n' '${POST_WITHHELD_LINE}'; exit 0; }`,
    "  trap 'withheld' HUP INT TERM",
    '  dir=$(dirname -- "$0") || withheld',
    '  [ -d "$dir/req" ] && [ -d "$dir/res" ] || withheld',
    '  tmp=$(mktemp "$dir/req/.XXXXXXXXXXXXXXXX") || withheld',
    "  name=${tmp##*/}",
    "  name=${name#.}",
    '  req="$dir/req/$name.json"',
    '  rm -f "$dir/res/$name" || withheld',
    '  cat > "$tmp" || withheld',
    '  mv "$tmp" "$req" || withheld',
    "  i=0",
    `  while [ "$i" -lt ${options.rounds} ]; do`,
    '    if [ -f "$dir/res/$name" ]; then',
    "      first=",
    '      IFS= read -r first < "$dir/res/$name"',
    '      rm -f "$dir/res/$name" || withheld',
    '      case "$first" in',
    "        {*) printf '%s\\n' \"$first\"; exit 0 ;;",
    "      esac",
    "      withheld",
    "    fi",
    "    sleep 0.1",
    "    i=$((i+1))",
    "  done",
    "  withheld",
    "fi",
    "deny() { printf '%s\\n' \"$1\" >&2; exit 2; }",
    "trap 'deny \"FlowDriven stopped this check, so this call is blocked.\"' HUP INT TERM",
    'dir=$(dirname -- "$0") || deny "FlowDriven could not find its folder, so this call is blocked."',
    'if [ "$1" = "start" ]; then',
    '  : > "$dir/started" || deny "FlowDriven could not record the start, so this step is blocked."',
    "  exit 0",
    "fi",
    '[ -d "$dir/req" ] && [ -d "$dir/res" ] || deny "FlowDriven is not running this step, so this call is blocked."',
    'tmp=$(mktemp "$dir/req/.XXXXXXXXXXXXXXXX") || deny "FlowDriven could not record this call, so it is blocked."',
    "name=${tmp##*/}",
    "name=${name#.}",
    'req="$dir/req/$name.json"',
    'rm -f "$dir/res/$name"',
    'cat > "$tmp" || deny "FlowDriven could not read this call, so it is blocked."',
    'mv "$tmp" "$req" || deny "FlowDriven could not hand over this call, so it is blocked."',
    "i=0",
    `while [ "$i" -lt ${options.rounds} ]; do`,
    '  if [ -f "$dir/res/$name" ]; then',
    "    first=",
    "    second=",
    '    { IFS= read -r first; IFS= read -r second; } < "$dir/res/$name"',
    '    rm -f "$dir/res/$name"',
    '    if [ "$first" = "allow" ]; then',
    `      printf '%s\\n' '${ALLOW_JSON}'`,
    "      exit 0",
    "    fi",
    '    if [ "$first" = "deny" ] && [ -n "$second" ]; then deny "$second"; fi',
    '    deny "FlowDriven did not allow this call."',
    "  fi",
    "  sleep 0.1",
    "  i=$((i+1))",
    "done",
    'deny "FlowDriven did not answer in time, so this call is blocked."',
    "",
  ].join("\n");
}

export function hookCommand(controlDir: string, start: boolean): string {
  if (!isSafeControlPath(controlDir)) throw new Error("The control folder path is not safe.");
  return `/bin/sh '${controlDir}/hook.sh'${start ? " start" : ""} || exit 2`;
}

export function postCommand(controlDir: string): string {
  if (!isSafeControlPath(controlDir)) throw new Error("The control folder path is not safe.");
  return `/bin/sh '${controlDir}/hook.sh' post || exit 2`;
}

export function settingsJson(controlDir: string, options?: { browser?: boolean }): string {
  return `${JSON.stringify(
    {
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: hookCommand(controlDir, true), timeout: HOOK_TIMEOUT_SECONDS },
            ],
          },
        ],
        PreToolUse: [
          {
            matcher: "*",
            hooks: [
              { type: "command", command: hookCommand(controlDir, false), timeout: HOOK_TIMEOUT_SECONDS },
            ],
          },
        ],
        ...(options?.browser
          ? {
              PostToolUse: [
                {
                  matcher: "mcp__claude-in-chrome__.*",
                  hooks: [
                    { type: "command", command: postCommand(controlDir), timeout: HOOK_TIMEOUT_SECONDS },
                  ],
                },
              ],
            }
          : {}),
      },
    },
    null,
    2,
  )}\n`;
}
