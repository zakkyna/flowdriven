export function protectedPath(path: string): boolean {
  const parts = path.split(/[\\/]/).map((part) =>
    [...part.normalize("NFKC").toUpperCase().toLowerCase().normalize("NFKC")]
      .filter((char) => {
        const point = char.codePointAt(0);
        return point !== undefined && point >= 0x21 && point <= 0x7e;
      })
      .join(""),
  );
  return parts.some((part) => part === ".git" || part === ".claude") || parts.at(-1) === ".mcp.json";
}
