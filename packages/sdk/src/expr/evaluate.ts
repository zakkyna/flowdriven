import { type Expr, parseExpression, type Scope, type Value } from "./parse.ts";
export type StepStatus =
  | "pending"
  | "running"
  | "retrying"
  | "waiting_approval"
  | "passed"
  | "failed"
  | "skipped"
  | "interrupted";
export function truthy(value: Value | undefined): boolean {
  return Boolean(value) && (!Array.isArray(value) || value.length > 0);
}
export function stepView(status: StepStatus, outputs: Record<string, Value>): Value {
  return {
    ...outputs,
    status,
    passed: status === "passed",
    failed: status === "failed",
    skipped: status === "skipped",
    outputs,
  };
}
function readName(value: Value | Scope | undefined, key: string, index = false): Value | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    if (!index || !/^(0|[1-9]\d*)$/.test(key)) return undefined;
  } else {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return undefined;
    if (index) return undefined;
  }
  return Object.prototype.propertyIsEnumerable.call(value, key)
    ? (value as Record<string, Value>)[key]
    : undefined;
}
export function evaluate(source: string | Expr, scope: Scope): Value | undefined {
  const expr = typeof source === "string" ? parseExpression(source) : source;
  function run(node: Expr, element?: Value): Value | undefined {
    switch (node.kind) {
      case "literal":
        return node.value;
      case "path": {
        const first = node.path.at(0);
        if (first === undefined) return undefined;
        const elementValue = readName(element, first);
        let value = elementValue === undefined ? readName(scope, first) : elementValue;
        for (let i = 1; i < node.path.length; i++) {
          const key = node.path[i];
          if (key === undefined) return undefined;
          value = readName(value, key, node.indices?.[i] ?? false);
        }
        return value;
      }
      case "list": {
        const values = node.items.map((item) => run(item, element));
        if (values.some((value) => value === undefined)) return undefined;
        return values as Value[];
      }
      case "not":
        return !truthy(run(node.operand, element));
      case "binary": {
        const left = run(node.left, element);
        if (node.op === "where")
          return Array.isArray(left) ? left.filter((item) => truthy(run(node.right, item))) : undefined;
        if (node.op === "and") return truthy(left) && truthy(run(node.right, element));
        if (node.op === "or") return truthy(left) || truthy(run(node.right, element));
        const right = run(node.right, element);
        if (node.op === "==") return (left ?? null) === (right ?? null);
        if (node.op === "!=") return (left ?? null) !== (right ?? null);
        if (node.op === "in")
          return Array.isArray(right)
            ? right.some((item) => item === left)
            : typeof right === "string" && typeof left === "string"
              ? right.includes(left)
              : false;
        if (
          (typeof left === "number" && typeof right === "number") ||
          (typeof left === "string" && typeof right === "string")
        ) {
          switch (node.op) {
            case "<":
              return left < right;
            case "<=":
              return left <= right;
            case ">":
              return left > right;
            case ">=":
              return left >= right;
          }
        }
        return false;
      }
    }
  }
  return run(expr);
}
