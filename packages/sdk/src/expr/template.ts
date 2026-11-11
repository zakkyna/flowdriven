import { evaluate } from "./evaluate.ts";
import { ExprError, type Scope, type Value } from "./parse.ts";

type Part = { kind: "text" | "expr"; value: string };
function parts(text: string): Part[] {
  const result: Part[] = [];
  let plain = "";
  for (let i = 0; i < text.length; ) {
    if (text.startsWith("$${", i)) {
      plain += "${";
      i += 3;
      continue;
    }
    if (text.startsWith("${", i)) {
      if (plain) result.push({ kind: "text", value: plain });
      plain = "";
      const end = text.indexOf("}", i + 2);
      if (end < 0) throw new ExprError("syntax", "Unclosed template expression");
      result.push({ kind: "expr", value: text.slice(i + 2, end) });
      i = end + 1;
      continue;
    }
    plain += text.charAt(i++);
  }
  if (plain) result.push({ kind: "text", value: plain });
  return result;
}
export function templateExpressions(text: string): string[] {
  return parts(text)
    .filter((part) => part.kind === "expr")
    .map((part) => part.value);
}
export function interpolate(text: string, scope: Scope): string {
  return parts(text)
    .map((part) => {
      if (part.kind === "text") return part.value;
      const value = evaluate(part.value, scope);
      if (value === undefined) throw new ExprError("unresolved", `Unresolved expression: ${part.value}`);
      return typeof value === "string"
        ? value
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    })
    .join("");
}
export function resolveValue(text: string, scope: Scope): Value | undefined {
  const parsed = parts(text);
  const first = parsed.at(0);
  if (parsed.length === 1 && first?.kind === "expr" && text.startsWith("${") && text.endsWith("}"))
    return evaluate(first.value, scope);
  return interpolate(text, scope);
}
