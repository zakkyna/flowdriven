/** @type {{from: number, to: number, cls: "zero-width" | "bidi-control" | "variation-selector" | "tag"}[]} */
export const HIDDEN_RANGES = [
  { from: 0x00ad, to: 0x00ad, cls: "zero-width" },
  { from: 0x034f, to: 0x034f, cls: "zero-width" },
  { from: 0x115f, to: 0x1160, cls: "zero-width" },
  { from: 0x17b4, to: 0x17b5, cls: "zero-width" },
  { from: 0x180b, to: 0x180f, cls: "zero-width" },
  { from: 0x200b, to: 0x200d, cls: "zero-width" },
  { from: 0x2028, to: 0x2029, cls: "zero-width" },
  { from: 0x2060, to: 0x2065, cls: "zero-width" },
  { from: 0x206a, to: 0x206f, cls: "zero-width" },
  { from: 0x2800, to: 0x2800, cls: "zero-width" },
  { from: 0x3164, to: 0x3164, cls: "zero-width" },
  { from: 0xfeff, to: 0xfeff, cls: "zero-width" },
  { from: 0xffa0, to: 0xffa0, cls: "zero-width" },
  { from: 0xfff9, to: 0xfffb, cls: "zero-width" },
  { from: 0x061c, to: 0x061c, cls: "bidi-control" },
  { from: 0x200e, to: 0x200f, cls: "bidi-control" },
  { from: 0x202a, to: 0x202e, cls: "bidi-control" },
  { from: 0x2066, to: 0x2069, cls: "bidi-control" },
  { from: 0xfe00, to: 0xfe0f, cls: "variation-selector" },
  { from: 0xe0100, to: 0xe01ef, cls: "variation-selector" },
  { from: 0xe0000, to: 0xe007f, cls: "tag" },
];

/**
 * @param {number} codePoint
 * @param {number} [next]
 * @returns {string | null}
 */
export function charClass(codePoint, next) {
  if (codePoint === 0x09 || codePoint === 0x0a || (codePoint === 0x0d && next === 0x0a)
    || (codePoint >= 0x20 && codePoint <= 0x7e)) return null;
  const char = String.fromCodePoint(codePoint);
  const hidden = HIDDEN_RANGES.find((range) => codePoint >= range.from && codePoint <= range.to);
  if (hidden) return hidden.cls;
  const ignorable = /\p{Default_Ignorable_Code_Point}/u.test(char);
  if (!ignorable && /[\p{L}\p{N}\p{P}\p{S}\p{M}]/u.test(char)) return null;
  if (/\p{Cc}/u.test(char)) return "control";
  if (ignorable || /\p{Cf}/u.test(char)) return "format";
  if (/[\p{Zl}\p{Zp}]/u.test(char)) return "separator";
  if (/\p{Zs}/u.test(char)) return "space";
  if (/\p{Co}/u.test(char)) return "private-use";
  return "unassigned";
}
