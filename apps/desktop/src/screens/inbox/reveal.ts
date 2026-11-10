const ranges = [
  [0x0000, 0x0008],
  [0x000b, 0x001f],
  [0x007f, 0x00a0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xd800, 0xdfff],
  [0xfffc, 0xfffc],
  [0x1d173, 0x1d17a],
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
export function splitHidden(text: string, singleLine = false): { text: string; hidden: boolean }[] {
  const parts: { text: string; hidden: boolean }[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const hidden =
      (singleLine && (code === 9 || code === 10)) ||
      ranges.some(([from, to]) => from !== undefined && to !== undefined && code >= from && code <= to);
    const last = parts[parts.length - 1];
    if (!hidden && last && !last.hidden) last.text += char;
    else parts.push({ text: char, hidden });
  }
  return parts;
}
