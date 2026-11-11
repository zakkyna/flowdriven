export type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
export type Scope = { [name: string]: Value | undefined };
export type ExprErrorCode = "syntax" | "forbidden_name" | "too_long" | "too_deep" | "unresolved";
export class ExprError extends Error {
  code: ExprErrorCode;
  constructor(code: ExprErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
export type Expr =
  | { kind: "literal"; value: Value }
  | { kind: "path"; path: string[] }
  | { kind: "list"; items: Expr[] }
  | { kind: "not"; operand: Expr }
  | { kind: "binary"; op: string; left: Expr; right: Expr };

export function parseExpression(source: string): Expr {
  if (source.length > 500) throw new ExprError("too_long", "Expression is too long");
  const tokens: string[] = [];
  let pos = 0;
  while (pos < source.length) {
    if (/\s/.test(source.charAt(pos))) {
      pos++;
      continue;
    }
    const rest = source.slice(pos);
    const match =
      /^(?:[A-Za-z_][A-Za-z0-9_-]*|-?\d+(?:\.\d+)?|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|==|!=|<=|>=|[()[\],.<>])/.exec(
        rest,
      );
    if (!match) throw new ExprError("syntax", `Unexpected character at ${pos}`);
    tokens.push(match[0]);
    pos += match[0].length;
  }
  let i = 0;
  let depth = 0;
  const peek = () => tokens.at(i);
  const take = () => tokens.at(i++);
  const expect = (token: string) => {
    if (take() !== token) throw new ExprError("syntax", `Expected ${token}`);
  };
  const nested = (fn: () => Expr): Expr => {
    depth++;
    if (depth > 20) throw new ExprError("too_deep", "Expression is too deep");
    const result = fn();
    depth--;
    return result;
  };
  const identifier = (s: string | undefined): s is string =>
    s !== undefined &&
    /^[A-Za-z_][A-Za-z0-9_-]*$/.test(s) &&
    !["and", "or", "not", "in", "where", "true", "false", "null"].includes(s);
  const checkName = (name: string) => {
    if (["__proto__", "constructor", "prototype"].includes(name))
      throw new ExprError("forbidden_name", `Forbidden name: ${name}`);
  };
  const primary = (): Expr => {
    const token = take();
    if (token === undefined) throw new ExprError("syntax", "Expected expression");
    if (token === "(") {
      const expr = nested(expression);
      expect(")");
      return expr;
    }
    if (token === "[") {
      const items: Expr[] = [];
      if (peek() !== "]") {
        items.push(nested(expression));
        while (peek() === ",") {
          take();
          items.push(nested(expression));
        }
      }
      expect("]");
      return { kind: "list", items };
    }
    if (token === "true" || token === "false" || token === "null")
      return { kind: "literal", value: token === "null" ? null : token === "true" };
    if (/^-?\d/.test(token)) {
      const value = Number(token);
      if (!Number.isFinite(value)) throw new ExprError("syntax", "Invalid number");
      return { kind: "literal", value };
    }
    if (token.startsWith("'") || token.startsWith('"')) {
      const body = token.slice(1, -1);
      if (body.includes("\\")) throw new ExprError("syntax", "String escapes are not specified");
      return { kind: "literal", value: body };
    }
    if (!identifier(token)) throw new ExprError("syntax", `Unexpected token: ${token}`);
    checkName(token);
    const path = [token];
    while (peek() === "." || peek() === "[") {
      if (take() === ".") {
        const segment = take();
        if (!identifier(segment)) throw new ExprError("syntax", "Expected path name");
        checkName(segment);
        path.push(segment);
      } else {
        const segment = take();
        if (segment === undefined || !/^\d+$/.test(segment))
          throw new ExprError("syntax", "Expected array index");
        expect("]");
        path.push(segment);
      }
      if (path.length > 20) throw new ExprError("too_deep", "Expression is too deep");
    }
    if (peek() === "(") throw new ExprError("syntax", "function calls are not allowed");
    return { kind: "path", path };
  };
  const cmp = (): Expr => {
    const left = primary();
    const op = peek();
    if (op !== undefined && ["==", "!=", "<", "<=", ">", ">=", "in"].includes(op)) {
      take();
      return { kind: "binary", op, left, right: primary() };
    }
    return left;
  };
  const not = (): Expr => {
    if (peek() === "not") {
      take();
      return { kind: "not", operand: nested(not) };
    }
    return cmp();
  };
  const chain = (next: () => Expr, op: string): Expr => {
    let left = next();
    while (peek() === op) {
      take();
      left = { kind: "binary", op, left, right: next() };
    }
    return left;
  };
  const and = () => chain(not, "and");
  const or = () => chain(and, "or");
  function expression(): Expr {
    return chain(or, "where");
  }
  const result = expression();
  if (peek() !== undefined)
    throw new ExprError(
      "syntax",
      peek() === "(" ? "function calls are not allowed" : `Unexpected token: ${peek()}`,
    );
  return result;
}
export function references(expr: Expr): string[][] {
  switch (expr.kind) {
    case "path":
      return [expr.path];
    case "literal":
      return [];
    case "list":
      return expr.items.flatMap(references);
    case "not":
      return references(expr.operand);
    case "binary":
      return [...references(expr.left), ...(expr.op === "where" ? [] : references(expr.right))];
  }
}
