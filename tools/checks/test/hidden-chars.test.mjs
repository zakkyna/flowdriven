import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { scanText, formatFinding } from "../hidden-chars.mjs";
import { charClass, HIDDEN_RANGES } from "../lib/ranges.mjs";

const cases = [
  [0x200b, "zero-width"], [0x200c, "zero-width"], [0x200d, "zero-width"], [0x2060, "zero-width"],
  [0xfeff, "zero-width"], [0x180e, "zero-width"], [0x061c, "bidi-control"], [0x200f, "bidi-control"],
  [0x202e, "bidi-control"], [0x2066, "bidi-control"], [0xfe0f, "variation-selector"],
  [0xe0100, "variation-selector"], [0xe0041, "tag"], [0xe007f, "tag"],
];

test("flags every hidden class", () => {
  for (const [cp, cls] of cases) {
    const found = scanText(`ab${String.fromCodePoint(cp)}c`, "x.md");
    assert.deepEqual(found, [{ path: "x.md", line: 1, column: 3, codePoint: cp, cls }]);
  }
});

test("reports line and column in code points", () => {
  const text = `ok\n${String.fromCodePoint(0x1f600)}${String.fromCodePoint(0x200b)}`;
  assert.deepEqual(scanText(text, "a.md").map((f) => [f.line, f.column]), [[2, 2]]);
});

test("passes ordinary text", () => {
  assert.deepEqual(scanText("café, naïve, 日本語, “quotes”, em — dash", "a.md"), []);
});

test("formats findings", () => {
  assert.equal(formatFinding({ path: "a.md", line: 3, column: 7, codePoint: 0x202e, cls: "bidi-control" }), "a.md:3:7 U+202E bidi-control");
  assert.equal(formatFinding({ path: "b.md", line: 1, column: 1, codePoint: 0xe0041, cls: "tag" }), "b.md:1:1 U+E0041 tag");
});

test("CLI passes on this repository", () => {
  const r = spawnSync(process.execPath, ["tools/checks/hidden-chars.mjs"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^hidden-chars: OK, 0 findings in \d+ files$/m);
});

test("every range edge is flagged with its class", () => {
  const edges = {
    "zero-width": [
      0x00ad, 0x034f, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180b, 0x180d, 0x180e, 0x180f,
      0x200b, 0x200d, 0x2028, 0x2029, 0x2060, 0x2064, 0x2065, 0x206a, 0x206f, 0x2800,
      0x3164, 0xfeff, 0xffa0, 0xfff9, 0xfffb,
    ],
    "bidi-control": [0x061c, 0x200e, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069],
    "variation-selector": [0xfe00, 0xfe0f, 0xe0100, 0xe01ef],
    tag: [0xe0000, 0xe007f],
  };
  for (const [cls, points] of Object.entries(edges)) {
    for (const point of points) {
      const findings = scanText(`a${String.fromCodePoint(point)}b`, "x");
      assert.equal(findings.length, 1, point.toString(16));
      assert.equal(findings[0].cls, cls);
    }
  }
});

test("neighbours of the ranges are not flagged", () => {
  const points = [
    0x0020, 0x000a, 0x00ac, 0x00ae, 0x034e, 0x0350, 0x061b, 0x061d, 0x115e, 0x1161,
    0x17b3, 0x17b6, 0x180a, 0x1810, 0x2010, 0x2027, 0x2070,
    0x27ff, 0x2801, 0x3163, 0x3165, 0xfdff, 0xfe10, 0xff9f, 0xffa1,
    0xfffc,
  ];
  for (const point of points) {
    assert.deepEqual(scanText(`a${String.fromCodePoint(point)}b`, "x"), []);
  }
});

test("formatFinding pads to four hex digits", () => {
  const bidi = { path: "a.md", line: 1, column: 1, codePoint: 0x061c, cls: "bidi-control" };
  const zero = { path: "a.md", line: 1, column: 1, codePoint: 0x00ad, cls: "zero-width" };
  assert.equal(formatFinding(bidi), "a.md:1:1 U+061C bidi-control");
  assert.equal(formatFinding(zero), "a.md:1:1 U+00AD zero-width");
});

test("a byte-order mark at the start of a file is a finding", () => {
  assert.deepEqual(scanText(`${String.fromCodePoint(0xfeff)}a`, "x"), [
    { path: "x", line: 1, column: 1, codePoint: 0xfeff, cls: "zero-width" },
  ]);
});

test("charClass allows ordinary text", () => {
  for (const point of [0x09, 0x0a, 0x41, 0x7e, 0xe9, 0xa9, 0x2026, 0x2192, 0x4e2d]) {
    assert.equal(charClass(point), null, point.toString(16));
  }
  assert.equal(charClass(0x0d, 0x0a), null);
});

test("charClass refuses by class", () => {
  const cases = {
    control: [0x08, 0x1b, 0x85, 0x9b], space: [0xa0, 0x3000], "private-use": [0xe000],
    unassigned: [0x0378], format: [0x0600, 0x1bca0, 0x1d173, 0xfff8, 0xe0080],
    "zero-width": [0x200b], "bidi-control": [0x202e], "variation-selector": [0xfe0f], tag: [0xe0041],
  };
  assert.equal(charClass(0x0d, 0x41), "control");
  for (const [cls, points] of Object.entries(cases)) {
    for (const point of points) {
      assert.equal(charClass(point), cls, point.toString(16));
    }
  }
});

test("the whole code space follows the rule", () => {
  for (let point = 0; point <= 0x10ffff; point++) {
    if (point >= 0xd800 && point <= 0xdfff) continue;
    const ch = String.fromCodePoint(point);
    const range = HIDDEN_RANGES.find((item) => point >= item.from && point <= item.to);
    const allowed = !range && (point === 0x09 || point === 0x0a || (point >= 0x20 && point <= 0x7e)
      || (/[\p{L}\p{N}\p{P}\p{S}\p{M}]/u.test(ch)
        && !/\p{Default_Ignorable_Code_Point}/u.test(ch)));
    assert.equal(charClass(point) === null, allowed, point.toString(16));
    if (range) assert.equal(charClass(point), range.cls, point.toString(16));
  }
});

test("scanText reports control characters and a lone carriage return", () => {
  const cr = String.fromCodePoint(0x0d);
  const esc = String.fromCodePoint(0x1b);
  assert.deepEqual(scanText(`a${cr}b`, "x"), [
    { path: "x", line: 1, column: 2, codePoint: 0x0d, cls: "control" },
  ]);
  assert.deepEqual(scanText(`a${cr}\nb`, "x"), []);
  assert.deepEqual(scanText(`a${esc}[8m`, "x"), [
    { path: "x", line: 1, column: 2, codePoint: 0x1b, cls: "control" },
  ]);
});
