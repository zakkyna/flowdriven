export function shellKind(): "electron" | "browser" {
  return (window as Window & { flowdrivenShell?: { kind: string } }).flowdrivenShell?.kind === "electron"
    ? "electron"
    : "browser";
}
