const networkModules = new Set(["http", "https", "net", "tls", "dgram", "http2", "undici", "ws"]);

type Token = { value: string; string: boolean };

export function findNetworkUse(source: string): string[] {
  const tokens: Token[] = [];
  const pattern =
    /\/\/[^\n\r]*|\/\*[\s\S]*?\*\/|(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`)|[A-Za-z_$][\w$]*|[^\s]/g;
  for (const match of source.matchAll(pattern)) {
    const value = match[0];
    if (value.startsWith("//") || value.startsWith("/*")) continue;
    const string = value.startsWith('"') || value.startsWith("'") || value.startsWith("`");
    tokens.push({ value: string ? value.slice(1, -1) : value, string });
  }
  const findings: string[] = [];
  const value = (i: number) => tokens[i]?.value;
  const checkModule = (i: number) => {
    const token = tokens[i];
    if (token?.string && networkModules.has(token.value.replace(/^node:/, ""))) findings.push(token.value);
  };
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]?.string) continue;
    if ((value(i) === "require" || value(i) === "import") && value(i + 1) === "(") checkModule(i + 2);
    if (value(i) === "import" || value(i) === "export") {
      let end = i + 1;
      while (end < tokens.length && value(end) !== ";" && value(end) !== "from" && !tokens[end]?.string)
        end++;
      const moduleIndex = value(end) === "from" ? end + 1 : end;
      checkModule(moduleIndex);
      if (
        value(moduleIndex) === "electron" &&
        value(i) === "import" &&
        tokens.slice(i + 1, end).some((t) => !t.string && t.value === "net")
      )
        findings.push("net");
    }
    if (value(i) === "fetch" && value(i + 1) === "(" && value(i - 1) !== ".") findings.push("fetch");
    if (value(i) === "session" && value(i + 1) === "." && value(i + 2) === "fetch" && value(i + 3) === "(")
      findings.push("session.fetch");
    if (
      value(i) === "new" &&
      (value(i + 1) === "WebSocket" || value(i + 1) === "XMLHttpRequest") &&
      value(i + 2) === "("
    )
      findings.push(value(i + 1) ?? "");
  }
  return findings;
}
