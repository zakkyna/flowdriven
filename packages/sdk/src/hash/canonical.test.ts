import { expect, test } from "vitest";
import { canonicalListing, contentHash } from "../node.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const A = "87428fc522803d31065e7bce3cf03fe475096631e5e07bbd7a0fde60c4cf25c7"; // sha256("a\n")
const B = "0263829989b6fd954f72baaf2fc64bc2e2f01d692d4de72986ea808f6e99813f"; // sha256("b\n")
test("lists files sorted, one line each", () =>
  expect(
    canonicalListing(
      new Map([
        ["flow.yaml", enc("a\n")],
        ["README.md", enc("b\n")],
      ]),
    ),
  ).toBe(`README.md\t${B}\nflow.yaml\t${A}\n`));
test("the hash of that listing", () =>
  expect(
    contentHash(
      new Map([
        ["flow.yaml", enc("a\n")],
        ["README.md", enc("b\n")],
      ]),
    ),
  ).toBe("sha256:90f425522946ec2eb405e1285976c5ce3a981f0a8577380667e1d09ec7a31ee6"));
test("insertion order does not matter", () =>
  expect(
    contentHash(
      new Map([
        ["README.md", enc("b\n")],
        ["flow.yaml", enc("a\n")],
      ]),
    ),
  ).toBe(
    contentHash(
      new Map([
        ["flow.yaml", enc("a\n")],
        ["README.md", enc("b\n")],
      ]),
    ),
  ));
test("sorts by UTF-8 bytes, not UTF-16 units", () => {
  const paths = ["a/\u{1F600}", "a/～", "a/z", "a/B"];
  expect(
    canonicalListing(new Map(paths.map((p) => [p, enc("x")])))
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("\t")[0]),
  ).toEqual(["a/B", "a/z", "a/～", "a/\u{1F600}"]);
});
test("hashes the bytes as they are", () =>
  expect(contentHash(new Map([["f.md", enc("a\r\n")]]))).not.toBe(
    contentHash(new Map([["f.md", enc("a\n")]])),
  ));
test("refuses unsafe paths", () => {
  for (const p of ["../x", "/x", "a\\b", "a\tb", "a/./b", "", "a//b", "x".repeat(513)])
    expect(() => canonicalListing(new Map([[p, enc("x")]]))).toThrowError(
      expect.objectContaining({ code: "invalid_path" }),
    );
});
test("a changed file or a renamed path changes the hash", () => {
  const base = contentHash(new Map([["a.md", enc("1")]]));
  expect(contentHash(new Map([["a.md", enc("2")]]))).not.toBe(base);
  expect(contentHash(new Map([["b.md", enc("1")]]))).not.toBe(base);
});

test("two packages whose paths differ only in a lone surrogate do not share a hash (or the path is refused)", () => {
  for (const code of [0xd800, 0xd801])
    expect(() => contentHash(new Map([[`a${String.fromCharCode(code)}.md`, enc("x")]]))).toThrowError(
      expect.objectContaining({ code: "invalid_path" }),
    );
});
