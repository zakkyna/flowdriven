import type { RiskyAction } from "../vocab.ts";
export function classifyTool(name: string): RiskyAction | undefined {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[_.\-\s]+/);
  const groups: [RiskyAction, string[]][] = [
    ["send", ["send", "reply", "forward"]],
    ["post", ["post", "publish"]],
    ["pay", ["pay", "purchase", "buy"]],
    ["delete", ["delete", "remove", "trash"]],
    ["merge", ["merge"]],
  ];
  return groups.find(([, names]) => names.some((word) => words.includes(word)))?.[0];
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
