export function visible(text: string, max: number): string {
  let result = "";
  for (const character of text) {
    const point = character.codePointAt(0);
    const piece =
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u.test(character) && point !== undefined
        ? `<U+${point.toString(16).toUpperCase().padStart(4, "0")}>`
        : character;
    if (result.length + piece.length > max) break;
    result += piece;
  }
  return result;
}

export function visibleLines(text: string, max: number): string {
  return text
    .split("\n")
    .map((line) => visible(line, max))
    .join("\n")
    .slice(0, max);
}
