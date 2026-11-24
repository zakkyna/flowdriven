import { afterEach, expect, test } from "vitest";
import { heldPayload } from "../exec/held.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { legacyGrant } from "../test-helpers/policy-fixture.ts";
import {
  callGrant,
  canonicalJson,
  createGrantBook,
  digestCall,
  grantUsedKey,
  isCallGrant,
  pickGrant,
} from "./grants.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
async function memoryStore() {
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  return store;
}
test("digestCall does not depend on key order at any depth, and is 64 lowercase hex characters", () => {
  const a = digestCall("send", { z: [{ b: 2, a: 1 }], a: { y: 2, x: 1 } });
  expect(a).toBe(digestCall("send", { a: { x: 1, y: 2 }, z: [{ a: 1, b: 2 }] }));
  expect(a).toMatch(/^[0-9a-f]{64}$/);
});
test("digestCall changes with the tool, with a value and with an extra key", () => {
  const base = digestCall("send", { a: 1 });
  expect(digestCall("delete", { a: 1 })).not.toBe(base);
  expect(digestCall("send", { a: 2 })).not.toBe(base);
  expect(digestCall("send", { a: 1, b: 2 })).not.toBe(base);
});
test("canonicalJson sorts keys, keeps array order and writes no spaces", () => {
  expect(canonicalJson({ z: [3, { b: true, a: null }, 1], a: "x" })).toBe(
    '{"a":"x","z":[3,{"a":null,"b":true},1]}',
  );
});
test("pickGrant and callGrant join as <requirement>.<tool> and <requirement>.<tool>#<digest>, and isCallGrant tells them apart", () => {
  expect(pickGrant("gmail", "send")).toBe("gmail.send");
  expect(callGrant("gmail", "send", "abc")).toBe("gmail.send#abc");
  expect(isCallGrant("gmail.send")).toBe(false);
  expect(isCallGrant("gmail.send#abc")).toBe(true);
});
test("a pick grant: has follows hasGrant for that run, tool and item key only, and use is true every time without counting", async () => {
  const store = await memoryStore();
  const book = createGrantBook(store);
  const grant = pickGrant("gmail", "send");
  expect(book.has("r1", grant, "j1")).toBe(false);
  store.putCallGrant(legacyGrant("r1", "*", "j1", grant));
  expect(book.has("r1", grant, "j1")).toBe(true);
  expect(book.has("r2", grant, "j1")).toBe(false);
  expect(book.has("r1", "gmail.delete", "j1")).toBe(false);
  expect(book.has("r1", grant, "j2")).toBe(false);
  expect(book.use("r1", grant, "j1")).toBe(true);
  expect(book.use("r1", grant, "j1")).toBe(true);
  expect(store.findPickGrant(legacyGrant("r1", "*", "j1", grant))?.usedAt).toBeUndefined();
});
test("a call grant: has is true after addGrant and before use, use is true once and then false, and has is false after use; the call grant cannot be used twice", async () => {
  const store = await memoryStore();
  const book = createGrantBook(store);
  const grant = callGrant("gmail", "send", "abc");
  const key = grantUsedKey("r1", "j1", grant);
  expect(key).toBe("grant-used:r1:j1:gmail.send#abc");
  expect(book.has("r1", grant, "j1")).toBe(false);
  store.putCallGrant(legacyGrant("r1", "*", "j1", grant));
  expect(book.has("r1", grant, "j1")).toBe(true);
  expect(book.use("r1", grant, "j1")).toBe(true);
  expect(store.findGrant(legacyGrant("r1", "*", "j1", grant))).toBeUndefined();
  expect(() => store.useGrant(legacyGrant("r1", "*", "j1", grant), "2026-11-22")).toThrow();
  expect(book.has("r1", grant, "j1")).toBe(false);
  expect(book.use("r1", grant, "j1")).toBe(false);
});

test("TC-SR1-23 heldPayload keeps the 4,000 character limit after marking hidden characters", () => {
  const hidden = String.fromCodePoint(0x200b);
  const marker = "[U+200B hidden character]";
  const padding = 4000 - JSON.stringify({ x: "" }, null, 2).length - marker.length;
  const text = heldPayload({ x: hidden + "a".repeat(padding) });
  expect(text).toHaveLength(4000);
  expect(text).toContain(marker);
  expect(heldPayload({ x: hidden + "a".repeat(padding + 1) })).toBeUndefined();
});
test("a pick grant is not honoured for an item key that starts with #, and not for the empty key", async () => {
  const store = await memoryStore();
  const book = createGrantBook(store);
  const grant = pickGrant("mail", "send");
  for (const key of ["#0", "#named", ""]) {
    store.putCallGrant(legacyGrant("r", "*", key, grant));
    expect(book.has("r", grant, key)).toBe(false);
    expect(book.use("r", grant, key)).toBe(false);
  }
});
test("a pick grant is honoured for a declared key as before, and use still does not count it", async () => {
  const store = await memoryStore();
  const book = createGrantBook(store);
  const grant = pickGrant("mail", "send");
  store.putCallGrant(legacyGrant("r", "*", "job", grant));
  expect(book.has("r", grant, "job")).toBe(true);
  expect(book.use("r", grant, "job")).toBe(true);
  expect(book.use("r", grant, "job")).toBe(true);
  expect(store.findPickGrant(legacyGrant("r", "*", "job", grant))?.usedAt).toBeUndefined();
});
test("a call grant is honoured and used once for a positional item key", async () => {
  const store = await memoryStore();
  const book = createGrantBook(store);
  const grant = callGrant("mail", "send", "digest");
  store.putCallGrant(legacyGrant("r", "*", "#0", grant));
  expect(book.has("r", grant, "#0")).toBe(true);
  expect(book.use("r", grant, "#0")).toBe(true);
  expect(book.has("r", grant, "#0")).toBe(false);
  expect(book.use("r", grant, "#0")).toBe(false);
});
