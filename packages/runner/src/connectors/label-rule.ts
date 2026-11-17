function holdsDiscardLabel(text: string): boolean {
  const folded = [...text.normalize("NFKC").toUpperCase().toLowerCase().normalize("NFKC")]
    .filter((char) => {
      const point = char.codePointAt(0);
      return point !== undefined && point >= 0x21 && point <= 0x7e;
    })
    .join("");
  return folded.includes("trash") || folded.includes("spam");
}

export function throwsMailAway(input: unknown): boolean {
  function visit(value: unknown, depth: number): boolean {
    if (typeof value === "string") return holdsDiscardLabel(value);
    if (value === null || typeof value !== "object") return false;
    if (depth > 20) return true;
    return Object.entries(value).some(([key, item]) => holdsDiscardLabel(key) || visit(item, depth + 1));
  }
  return visit(input, 1);
}
