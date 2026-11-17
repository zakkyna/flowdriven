import type { RiskyAction } from "../vocab.ts";
// Joined lowercase words such as sendmessage remain a classifier limit until the tool catalog.
export function classifyTool(name: string): RiskyAction | undefined {
  const words = name
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u);
  const groups: [RiskyAction, string[]][] = [
    ["send", ["send", "reply", "forward"]],
    ["post", ["post", "publish"]],
    ["pay", ["pay", "purchase", "buy"]],
    ["delete", ["delete", "remove", "trash", "spam"]],
    ["merge", ["merge"]],
  ];
  return groups.find(([, names]) => names.some((word) => words.includes(word)))?.[0];
}
export function classifyCommand(pattern: string): RiskyAction | undefined {
  const words = pattern.trim().split(/\s+/);
  const program = words[0]?.split(/[\\/]/).at(-1) ?? "";
  if (!program || program.includes("*") || ["rm", "rmdir", "unlink", "shred", "trash"].includes(program))
    return "delete";
  if (words.includes("merge")) return "merge";
  if (
    words.includes("push") &&
    words.some((word) => ["--force", "-f", "--force-with-lease"].includes(word) || word.startsWith("+"))
  )
    return "delete";
  if (words.includes("delete")) return "delete";
  if (words.includes("publish")) return "post";
  return undefined;
}
export function commandAllowed(entry: string, cmd: string, args: string[]): boolean {
  const words = entry.split(" ");
  if (words.some((word) => !word) || words.at(0) !== cmd) return false;
  const declared = words.slice(1);
  const wildcard = declared.at(-1) === "*";
  const fixed = wildcard ? declared.slice(0, -1) : declared;
  return (
    (wildcard ? args.length >= fixed.length : args.length === fixed.length) &&
    fixed.every((word, i) => word === args.at(i))
  );
}
