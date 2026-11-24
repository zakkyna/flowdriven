const networkModules = new Set(["http", "https", "net", "tls", "dgram", "http2", "undici", "ws", "dns"]);

type Token = { value: string; string: boolean };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const code = (templateExpression = false) => {
    let braces = 0;
    while (i < source.length) {
      const ch = source[i] ?? "";
      if (/\s/.test(ch)) {
        i++;
        continue;
      }
      if (source.startsWith("//", i)) {
        i = source.indexOf("\n", i);
        if (i < 0) i = source.length;
        continue;
      }
      if (source.startsWith("/*", i)) {
        const end = source.indexOf("*/", i + 2);
        i = end < 0 ? source.length : end + 2;
        continue;
      }
      if (ch === "`") {
        i++;
        while (i < source.length) {
          if (source[i] === "\\") {
            i += 2;
            continue;
          }
          if (source[i] === "`") {
            i++;
            break;
          }
          if (source.startsWith("${", i)) {
            i += 2;
            code(true);
            continue;
          }
          i++;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        const start = ++i;
        while (i < source.length && source[i] !== ch) {
          if (source[i] === "\\") i++;
          i++;
        }
        tokens.push({ value: source.slice(start, i), string: true });
        i++;
        continue;
      }
      const previous = tokens.at(-1)?.value;
      if (
        ch === "/" &&
        (!previous ||
          /^(?:[([{,:;=!?&|+*%~<>^-]|return|throw|case|delete|void|typeof|instanceof|in|of|yield|await)$/.test(
            previous,
          ))
      ) {
        i++;
        let characterClass = false;
        while (i < source.length) {
          const part = source[i++];
          if (part === "\\") {
            i++;
            continue;
          }
          if (part === "[") characterClass = true;
          if (part === "]") characterClass = false;
          if (part === "/" && !characterClass) break;
        }
        while (i < source.length && /[a-z]/i.test(source[i] ?? "")) i++;
        tokens.push({ value: "<regex>", string: false });
        continue;
      }
      if (templateExpression && ch === "}" && braces === 0) {
        i++;
        return;
      }
      if (ch === "{") braces++;
      if (ch === "}") braces--;
      const identifier = /^[A-Za-z_$][\w$]*/.exec(source.slice(i))?.[0];
      const value = identifier ?? ch;
      tokens.push({ value, string: false });
      i += value.length;
    }
  };
  code();
  return tokens;
}

export function findNetworkUse(source: string): string[] {
  const tokens = tokenize(source);
  const findings: string[] = [];
  const value = (i: number) => tokens[i]?.value;
  const electronNames = new Set<string>();
  const checkModule = (i: number) => {
    const token = tokens[i];
    if (token?.string && networkModules.has(token.value.replace(/^node:/, ""))) findings.push(token.value);
  };
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]?.string) continue;
    if ((value(i) === "require" || value(i) === "import") && value(i + 1) === "(") {
      if (!tokens[i + 2]?.string || value(i + 3) !== ")") findings.push(value(i) ?? "");
      else checkModule(i + 2);
      if (value(i) === "require" && value(i + 2) === "electron" && value(i + 3) === ")") {
        if (value(i + 4) === "." && value(i + 5) === "net") findings.push("net");
        let start = i - 1;
        while (
          start >= 0 &&
          value(start) !== ";" &&
          value(start) !== "const" &&
          value(start) !== "let" &&
          value(start) !== "var"
        )
          start--;
        const binding = tokens.slice(start + 1, i);
        if (binding.some((t) => t.value === "net")) findings.push("net");
        if (binding[0]?.value !== "{" && binding[0]) electronNames.add(binding[0].value);
      }
    }
    if ((value(i) === "import" && value(i + 1) !== "(") || value(i) === "export") {
      let end = i + 1;
      while (end < tokens.length && value(end) !== ";" && value(end) !== "from" && !tokens[end]?.string)
        end++;
      const moduleIndex = value(end) === "from" ? end + 1 : end;
      checkModule(moduleIndex);
      if (value(moduleIndex) === "electron" && value(i) === "import") {
        const bindings = tokens.slice(i + 1, end);
        if (bindings.some((t) => !t.string && t.value === "net")) findings.push("net");
        if (bindings[0] && bindings[0].value !== "{" && bindings[0].value !== "*")
          electronNames.add(bindings[0].value);
        const star = bindings.findIndex((t) => t.value === "*");
        const namespace = bindings[star + 2];
        if (star >= 0 && bindings[star + 1]?.value === "as" && namespace) electronNames.add(namespace.value);
      }
    }
    if (electronNames.has(value(i) ?? "") && value(i + 1) === "." && value(i + 2) === "net")
      findings.push("net");
    if (value(i) === "fetch") {
      const direct =
        value(i + 1) === "(" ||
        (value(i + 1) === "?" && value(i + 2) === "." && value(i + 3) === "(") ||
        (value(i + 1) === "." &&
          (value(i + 2) === "call" || value(i + 2) === "apply") &&
          value(i + 3) === "(");
      if (direct && (value(i - 1) !== "." || ["globalThis", "window", "self"].includes(value(i - 2) ?? "")))
        findings.push("fetch");
      if (direct && (value(i - 2) === "session" || value(i - 2) === "defaultSession"))
        findings.push("session.fetch");
      if (direct && value(i - 1) === "." && value(i - 2) === ")") {
        let depth = 1;
        let j = i - 3;
        for (; j >= 0 && depth > 0; j--) {
          if (value(j) === ")") depth++;
          if (value(j) === "(") depth--;
        }
        if (value(j) === "fromPartition") findings.push("session.fetch");
      }
    }
    if (value(i) === "new") {
      const index = value(i + 1) === "globalThis" && value(i + 2) === "." ? i + 3 : i + 1;
      if ((value(index) === "WebSocket" || value(index) === "XMLHttpRequest") && value(index + 1) === "(")
        findings.push(value(index) ?? "");
    }
  }
  return findings;
}
