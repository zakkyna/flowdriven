const ranges = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0x2800, 0x2800],
  [0x3164, 0x3164],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff9, 0xfffb],
  [0x061c, 0x061c],
  [0xfe00, 0xfe0f],
  [0xe0100, 0xe01ef],
  [0xe0000, 0xe007f],
];
export function splitHidden(text: string): { text: string; hidden: boolean }[] {
  const parts: { text: string; hidden: boolean }[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const hidden = ranges.some(
      ([from, to]) => from !== undefined && to !== undefined && code >= from && code <= to,
    );
    const last = parts[parts.length - 1];
    if (!hidden && last && !last.hidden) last.text += char;
    else parts.push({ text: char, hidden });
  }
  return parts;
}
