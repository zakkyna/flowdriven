import { expect, test } from "vitest";
import { checkLanguages, formatFinding, formatUntranslated } from "./check";
import { pendingKeys } from "./pending-keys";
import { createT } from "./t";
import { BASE, language, tree } from "./test-helpers/tree";

function first<T>(items: T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error("Expected an item");
  return item;
}
async function check(
  changes: Record<string, string> = {},
  lineKeys: string[] = [],
  allowlist: { key: string; text: string; reason: string }[] = [],
) {
  const names = Object.keys(changes)
    .map((file) => /^lang\/([\w-]+)\.ts$/.exec(file)?.[1])
    .filter((name) => name && !["en", "id", "languages", "dynamic-keys"].includes(name));
  const registered = names.map((name) => `import "./${name}";`).join(" ");
  const temp = await tree({
    ...changes,
    "lang/languages.ts": changes["lang/languages.ts"] ?? `${BASE["lang/languages.ts"]} ${registered}`,
  });
  try {
    return await checkLanguages({
      root: temp.root,
      lineKeys,
      allowlist,
      load: (path) => import(/* @vite-ignore */ path),
    });
  } finally {
    await temp.cleanup();
  }
}
const extra = (file: string, code: string, words: string) => ({ [`lang/${file}.ts`]: language(code, words) });
const used = `used: "Xused", one: "One {n}", two: { other: "{n} items" }`;

test("TC-I18N-13 TC-j30-28 missing translations and Indonesian completeness", async () => {
  const result = await check(extra("xx", "xx", `used: "Xused"`));
  expect(result.findings).toEqual([]);
  expect(result.untranslated).toEqual([{ language: "xx", keys: ["a.one", "a.two"] }]);
  expect(formatUntranslated(first(result.untranslated))).toBe(
    "xx: 2 words not translated yet, shown in English: a.one, a.two",
  );
  const incomplete = await check({ "lang/id.ts": BASE["lang/id.ts"].replace('used: "Dipakai",', "") });
  expect(incomplete.findings).toMatchObject([
    { kind: "incomplete_indonesian", file: "lang/id.ts", key: "a.used" },
  ]);
});
test("TC-I18N-14 Indonesian finding format", async () => {
  const result = await check({ "lang/id.ts": BASE["lang/id.ts"].replace('used: "Dipakai",', "") });
  expect(formatFinding(first(result.findings))).toBe(
    "lang/id.ts a.used: missing in Indonesian, which must be complete. Fix: add a.used to lang/id.ts.",
  );
});
test("TC-I18N-15 missing English source key", async () => {
  const result = await check({ "src/app.ts": `${BASE["src/app.ts"]}\nt("a.missing");` });
  expect(result.findings).toMatchObject([
    { kind: "missing_key_in_english", file: "src/app.ts", key: "a.missing", line: 4 },
  ]);
  expect(formatFinding(first(result.findings))).toBe(
    "src/app.ts:4 a.missing: used in code but missing in English. Fix: add a.missing to lang/en.ts, or use a key that exists.",
  );
});
test("TC-I18N-16 unused, line and dynamic keys", async () => {
  const changes = {
    "lang/en.ts": BASE["lang/en.ts"].replace('used: "Used",', 'unused: "Never read", used: "Used",'),
    "lang/id.ts": BASE["lang/id.ts"].replace('used: "Dipakai",', 'unused: "Never read", used: "Dipakai",'),
  };
  expect((await check(changes)).findings).toMatchObject([{ kind: "unused_english_key", key: "a.unused" }]);
  expect((await check(changes, ["a.unused"])).findings).toEqual([]);
  expect(
    (await check({ ...changes, "lang/dynamic-keys.ts": 'export const dynamicKeys = ["a.unused"] as const;' }))
      .findings,
  ).toEqual([]);
});
test("TC-I18N-17 extra key", async () => {
  const result = await check(extra("xx", "xx", 'used: "Xused", extra: "Nope"'));
  expect(result.findings).toMatchObject([{ kind: "extra_key", file: "lang/xx.ts", key: "a.extra" }]);
  expect(formatFinding(first(result.findings))).toBe(
    "lang/xx.ts a.extra: this key is not in English. Fix: remove a.extra from lang/xx.ts, or add it to lang/en.ts first.",
  );
});
test("TC-I18N-18 placeholder differences", async () => {
  const renamed = await check({
    "lang/id.ts": BASE["lang/id.ts"].replace('one: "Satu {n}"', 'one: "Satu {m}"'),
  });
  expect(formatFinding(first(renamed.findings.filter(({ kind }) => kind === "placeholder_mismatch")))).toBe(
    "lang/id.ts a.one: has {m} but English has {n}. Fix: use {n}.",
  );
  for (const replacement of ['one: "Satu {m}"', 'one: "Satu"', 'one: "Satu {n} {n2}"']) {
    expect(
      (await check({ "lang/id.ts": BASE["lang/id.ts"].replace('one: "Satu {n}"', replacement) })).findings,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "placeholder_mismatch", key: "a.one" })]),
    );
  }
  expect(
    (await check({ "lang/id.ts": BASE["lang/id.ts"].replace("{n} butir", "{count} butir") })).findings,
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: "placeholder_mismatch", key: "a.two" })]),
  );
});
test("TC-I18N-19 TC-j30-29 missing other and fallback", async () => {
  expect(
    (await check(extra("xx", "xx", 'used: "Xused", one: "One {n}", two: { one: "{n} x" }'))).findings,
  ).toMatchObject([{ kind: "missing_other_form", key: "a.two" }]);
  expect(
    (await check({ "lang/en.ts": BASE["lang/en.ts"].replace(', other: "{n} items"', "") })).findings,
  ).toMatchObject([{ kind: "missing_other_form", file: "lang/en.ts" }]);
  expect(
    createT([{ code: "xx", name: "X", words: { a: { two: { other: "{n} y" } } } }])("a.two", { n: 7 }, "xx"),
  ).toBe("7 y");
});
test("TC-I18N-20 plural categories", async () => {
  expect(
    (
      await check({
        "lang/id.ts": BASE["lang/id.ts"].replace(
          'other: "{n} butir"',
          'one: "{n} butir", other: "{n} butir"',
        ),
      })
    ).findings,
  ).toMatchObject([{ kind: "unknown_plural_form", form: "one" }]);
  expect(
    (
      await check({
        "lang/en.ts": BASE["lang/en.ts"].replace('one: "{n} item"', 'few: "{n} item", one: "{n} item"'),
      })
    ).findings,
  ).toMatchObject([{ kind: "unknown_plural_form", form: "few" }]);
  expect(
    (
      await check(
        extra(
          "pl",
          "pl",
          'used: "Xused", one: "One {n}", two: { one: "{n} x", few: "{n} x", many: "{n} x", other: "{n} x" }',
        ),
      )
    ).findings,
  ).toEqual([]);
});
test("TC-I18N-21 invalid codes", async () => {
  for (const code of ["Zz_1", "english"])
    expect((await check(extra("zz", code, used))).findings).toMatchObject([
      { kind: "invalid_code", file: "lang/zz.ts" },
    ]);
});
test("TC-I18N-22 TC-j30-30 duplicate and file codes", async () => {
  expect((await check({ ...extra("xx", "xx", used), ...extra("yy", "xx", used) })).findings).toMatchObject([
    { kind: "duplicate_code", file: "lang/yy.ts" },
  ]);
  expect(
    (await check({ "lang/id.ts": BASE["lang/id.ts"].replace('code: "id"', 'code: "en"') })).findings,
  ).toMatchObject([{ kind: "duplicate_code", file: "lang/id.ts" }]);
  expect((await check(extra("xx", "yy", used))).findings).toMatchObject([
    { kind: "file_name_code_mismatch" },
  ]);
  expect((await check(extra("pt-br", "pt-BR", used))).findings).toEqual([]);
});

test("TC-j30-28 multiple untranslated keys", async () => {
  const result = await check(extra("xx", "xx", 'used: "Xused"'));
  expect(result.findings).toEqual([]);
  expect(result.untranslated).toEqual([{ language: "xx", keys: ["a.one", "a.two"] }]);
});
test("TC-j30-29 Arabic forms and Indonesian fix", async () => {
  const result = await check({
    "lang/id.ts": BASE["lang/id.ts"].replace('other: "{n} butir"', 'one: "{n} butir", other: "{n} butir"'),
  });
  expect(formatFinding(first(result.findings))).toContain("use only these forms for id: other");
  expect(
    (await check(extra("ar", "ar", 'used: "Xused", one: "One {n}", two: { few: "{n} a", other: "{n} b" }')))
      .findings,
  ).toEqual([]);
});
test("TC-j30-30 invalid, duplicate and case-insensitive file names", async () => {
  const result = await check({
    ...extra("x_", "x_", used),
    ...extra("aa", "aa", used),
    ...extra("ab", "aa", used),
    ...extra("pt-br", "pt-BR", used),
  });
  expect(result.findings.map(({ kind, file }) => ({ kind, file }))).toEqual([
    { kind: "duplicate_code", file: "lang/ab.ts" },
    { kind: "invalid_code", file: "lang/x_.ts" },
  ]);
});

test("TC-I18N-23 unregistered language", async () => {
  expect(
    (await check({ ...extra("zz", "zz", used), "lang/languages.ts": BASE["lang/languages.ts"] })).findings,
  ).toContainEqual(expect.objectContaining({ kind: "not_in_list", file: "lang/zz.ts" }));
});
test("TC-I18N-24 hidden characters", async () => {
  for (const cp of [0x200b, 0x202e, 0xa0, 0xfeff, 0x2066, 0xe0041]) {
    const result = await check({
      "lang/id.ts": BASE["lang/id.ts"].replace("Dipakai", `Dipakai${String.fromCodePoint(cp)}`),
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({ kind: "hidden_character", file: "lang/id.ts", line: 5, key: "a.used" }),
    );
  }
  expect(
    (await check({ "lang/id.ts": BASE["lang/id.ts"].replace("Dipakai", "é ñ 日本語") })).findings,
  ).toEqual([]);
});
test("TC-I18N-25 markup", async () => {
  for (const value of [
    "<b>Dipakai</b>",
    "Dipakai <img src=x>",
    "Dipakai &amp; lagi",
    "Dipakai &#8203;",
    "<!-- hi -->",
  ]) {
    expect(
      (await check({ "lang/id.ts": BASE["lang/id.ts"].replace("Dipakai", value) })).findings,
    ).toContainEqual(expect.objectContaining({ kind: "markup_in_value", key: "a.used" }));
  }
  expect(
    (await check({ "lang/id.ts": BASE["lang/id.ts"].replace("Dipakai", "a < b dan c > d") })).findings,
  ).toEqual([]);
});
test("TC-I18N-26 addresses", async () => {
  for (const value of [
    "https://example.com",
    "http://example.com/x",
    "www.example.com",
    "ftp://example.com",
    "mailto:sam@example.com",
  ]) {
    expect(
      (await check({ "lang/id.ts": BASE["lang/id.ts"].replace("Dipakai", value) })).findings,
    ).toContainEqual(expect.objectContaining({ kind: "web_address_in_value", key: "a.used" }));
  }
  expect((await check()).findings).toEqual([]);
});
test("TC-I18N-27 invalid and unknown placeholders", async () => {
  for (const [value, kind] of [
    ["{who}", "unknown_placeholder"],
    ["{", "bad_placeholder"],
    ["{}", "bad_placeholder"],
    ["{ n }", "bad_placeholder"],
  ]) {
    expect(
      (await check({ "lang/id.ts": BASE["lang/id.ts"].replace("Dipakai", `Dipakai ${value}`) })).findings,
    ).toContainEqual(expect.objectContaining({ kind, file: "lang/id.ts" }));
  }
  expect(
    (await check({ "lang/en.ts": BASE["lang/en.ts"].replace("Used", "Used {1}") })).findings,
  ).toContainEqual(expect.objectContaining({ kind: "bad_placeholder", file: "lang/en.ts" }));
});
test("TC-I18N-28 TC-j30-32 glued sentences", async () => {
  const source =
    't("a.two");\n// used\nconst a = t("a.one") + " " + t("a.used");\nconst b = `${t("a.one")} ${t("a.used")}`;\nconst c = [t("a.one"), t("a.used")].join(" ");\nconst d = t("a.one"); const e = t("a.used");';
  const result = await check({
    "src/app.ts": source,
    "src/view.tsx": '<span>{t("a.one")}</span><span>{t("a.used")}</span>',
  });
  expect(result.findings.map(({ kind, line }) => ({ kind, line }))).toEqual(
    [3, 4, 5].map((line) => ({ kind: "glued_sentence", line })),
  );
  expect(
    createT([{ code: "id", name: "Indonesia", words: { chat: { starting: "Menjalankan {flow}." } } }])(
      "chat.starting",
      { flow: "Fill timesheet" },
      "id",
    ),
  ).toBe("Menjalankan Fill timesheet.");
});
test("TC-j30-20 multiple finding kinds and dynamic keys", async () => {
  const result = await check({
    "lang/id.ts": BASE["lang/id.ts"].replace('other: "{n} butir"', 'other: "{m} butir"'),
    "lang/zz.ts": language("zz", used),
    "lang/languages.ts": BASE["lang/languages.ts"],
    "src/app.ts": `${BASE["src/app.ts"]}\nt("b." + code);`,
  });
  expect(result.findings.map(({ kind }) => kind)).toEqual(
    expect.arrayContaining(["placeholder_mismatch", "not_in_list", "dynamic_key_unlisted"]),
  );
});
test("TC-j30-31 TC-I18N-29 formatted findings", async () => {
  const result = await check({ "lang/id.ts": BASE["lang/id.ts"].replace("Dipakai", "<b>Dipakai</b>") });
  expect(result.findings.length).toBeGreaterThan(0);
  for (const finding of result.findings)
    expect(formatFinding(finding)).toMatch(/^lang\/id\.ts.*a\.used: .*Fix: .+\.$/);
});
test("TC-I18N-35 plain words and allowlist", async () => {
  for (const [value, kind] of [
    ["sandbox", "forbidden_word"],
    ["run-abcdef", "run_id_in_value"],
    ["v123", "version_in_value"],
  ] as const) {
    expect(
      (await check({ "lang/id.ts": BASE["lang/id.ts"].replace("Dipakai", value) })).findings,
    ).toContainEqual(expect.objectContaining({ kind, key: "a.used" }));
  }
  const changes = { "lang/id.ts": BASE["lang/id.ts"].replace("Dipakai", "sandbox") };
  expect((await check(changes, [], [{ key: "a.used", text: "sandbox", reason: "test" }])).findings).toEqual(
    [],
  );
  expect((await check({}, [], [{ key: "a.used", text: "sandbox", reason: "test" }])).findings).toContainEqual(
    expect.objectContaining({ kind: "stale_allowlist" }),
  );
});
test("TC-j30-21 TC-I18N-30 real tree", async () => {
  const result = await checkLanguages({
    root: process.cwd(),
    lineKeys: (await import("@flowdriven/contracts")).LINE_KEYS,
    pendingKeys,
    load: (path) => import(/* @vite-ignore */ path),
  });
  expect(result.findings.map(formatFinding)).toEqual([]);
  expect(result.untranslated.filter(({ language }) => language === "id")).toEqual([]);
});

test("TC-I18N-32 every Line key has English and Indonesian words", async () => {
  const { LINE_KEYS } = await import("@flowdriven/contracts");
  const { default: en } = await import("./en");
  const { default: id } = await import("./id");
  for (const key of LINE_KEYS) {
    for (const words of [en.words, id.words]) {
      const value = key
        .split(".")
        .reduce<unknown>(
          (v, part) =>
            typeof v === "object" && v !== null ? (v as Record<string, unknown>)[part] : undefined,
          words,
        );
      expect(value, key).toBeDefined();
      if (typeof value === "object" && value !== null) expect(value, key).toHaveProperty("other");
    }
  }
});

test("TC-I18N-32 reports an unused Line key on a scratch tree", async () => {
  const temp = await tree();
  try {
    const result = await checkLanguages({
      root: temp.root,
      lineKeys: ["a.used"],
      checkUnusedLineKeys: true,
      load: (path) => import(/* @vite-ignore */ path),
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        kind: "unused_line_key",
        key: "a.used",
        message: expect.stringContaining("remove it from line-keys.ts"),
      }),
    );
  } finally {
    await temp.cleanup();
  }
});
