import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { isValidLanguageCode } from "./languages";
import { pluralCategories } from "./plural";

export type Finding = {
  kind: string;
  file: string;
  key?: string;
  line?: number;
  form?: string;
  message: string;
};
type Entry = { language: string; keys: string[] };
type Word = string | Record<string, string>;
type Language = { code: string; words: Record<string, unknown> };

export function formatFinding(finding: Finding): string {
  return finding.message;
}
export function formatUntranslated(entry: Entry): string {
  return `${entry.language}: ${entry.keys.length} words not translated yet, shown in English: ${entry.keys.join(", ")}`;
}
async function files(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const result: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "test-helpers") result.push(...(await files(path)));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) result.push(path);
  }
  return result;
}
function flatten(value: Record<string, unknown>, prefix = ""): Map<string, Word> {
  const result = new Map<string, Word>();
  for (const [name, child] of Object.entries(value)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (typeof child === "string") result.set(key, child);
    else if (typeof child === "object" && child !== null) {
      const obj = child as Record<string, unknown>;
      if (
        Object.keys(obj).some((form) => ["zero", "one", "two", "few", "many", "other"].includes(form)) &&
        Object.values(obj).every((item) => typeof item === "string")
      )
        result.set(key, obj as Record<string, string>);
      else for (const [nested, word] of flatten(obj, key)) result.set(nested, word);
    }
  }
  return result;
}
function placeholders(value: string): string[] {
  return [...new Set(value.match(/\{\w+\}/g) ?? [])].sort();
}
export async function checkLanguages(options: {
  root: string;
  load: (path: string) => Promise<{ default: Language }>;
  lineKeys?: readonly string[];
  languageDir?: string;
  sourceDirs?: readonly string[];
  pendingKeys?: readonly string[];
  allowlist?: readonly { key: string; text: string; reason: string }[];
}): Promise<{ findings: Finding[]; untranslated: Entry[] }> {
  const { root } = options;
  const languageDir =
    options.languageDir ?? ((await files(join(root, "lang"))).length ? "lang" : "apps/desktop/src/i18n");
  const sourceDirs =
    options.sourceDirs ?? (languageDir === "lang" ? ["src"] : ["apps/desktop/src", "apps/desktop/electron"]);
  const findings: Finding[] = [];
  const untranslated: Entry[] = [];
  const add = (
    kind: string,
    file: string,
    text: string,
    details: { key?: string; line?: number; form?: string } = {},
  ) =>
    findings.push({
      kind,
      file,
      ...details,
      message: `${file}${details.line ? `:${details.line}` : ""}${details.key ? ` ${details.key}` : ""}: ${text}`,
    });
  const ignored = new Set([
    "languages.ts",
    "dynamic-keys.ts",
    "pending-keys.ts",
    "t.ts",
    "plural.ts",
    "when.ts",
    "status.ts",
    "check.ts",
  ]);
  const paths = (await files(join(root, languageDir))).filter(
    (path) => !ignored.has(basename(path)) && !path.includes("/test-helpers/"),
  );
  const langs: { file: string; value: Language; words: Map<string, Word> }[] = [];
  for (const path of paths.sort()) {
    const value = (await options.load(path)).default;
    langs.push({ file: relative(root, path), value, words: flatten(value.words) });
  }
  const english = langs.find(({ value }) => value.code === "en");
  if (!english) return { findings, untranslated };
  const englishFile = join(languageDir, "en.ts");
  const listText = await readFile(join(root, languageDir, "languages.ts"), "utf8");
  const allowlist = options.allowlist ?? [];
  for (const entry of allowlist) {
    if (
      !langs.some(({ words }) => {
        const word = words.get(entry.key);
        return (
          word !== undefined && (typeof word === "string" ? [word] : Object.values(word)).includes(entry.text)
        );
      })
    )
      add(
        "stale_allowlist",
        join(languageDir, "check.ts"),
        "allowlist entry no longer exists. Fix: remove it.",
        { key: entry.key },
      );
  }
  const seen = new Map<string, string>();
  for (const { file, value, words } of langs) {
    const { code } = value;
    const name = basename(file, ".ts");
    if (!new RegExp(`["']\\./${name}["']`).test(listText))
      add(
        "not_in_list",
        file,
        `this language file is not in the list. Fix: add one line for it to ${languageDir}/languages.ts.`,
      );
    const source = await readFile(join(root, file), "utf8");
    if (!isValidLanguageCode(code))
      add(
        "invalid_code",
        file,
        `the code "${code}" is not a valid language tag. Fix: use a code such as "fr" or "pt-BR".`,
      );
    else if (seen.has(code.toLowerCase()))
      add(
        "duplicate_code",
        file,
        `the code "${code}" is already used by ${seen.get(code.toLowerCase())}. Fix: give this language its own code.`,
      );
    else {
      seen.set(code.toLowerCase(), file);
      if (basename(file, ".ts").toLowerCase() !== code.toLowerCase())
        add(
          "file_name_code_mismatch",
          file,
          `the file name does not match code "${code}". Fix: name the file after its code.`,
        );
    }
    const missing: string[] = [];
    for (const key of english.words.keys())
      if (!words.has(key)) {
        if (code === "id")
          add(
            "incomplete_indonesian",
            file,
            `missing in Indonesian, which must be complete. Fix: add ${key} to ${file}.`,
            { key },
          );
        else missing.push(key);
      }
    if (missing.length && code !== "id") untranslated.push({ language: code, keys: missing });
    for (const [key, word] of words) {
      const reference = english.words.get(key);
      const referenceTexts =
        reference === undefined ? [] : typeof reference === "string" ? [reference] : Object.values(reference);
      const expectedAll = new Set(referenceTexts.flatMap(placeholders));
      for (const text of typeof word === "string" ? [word] : Object.values(word)) {
        const lineIndex = source.indexOf(text);
        const line = lineIndex < 0 ? undefined : source.slice(0, lineIndex).split("\n").length;
        for (const char of text) {
          if (/\p{Cf}|\u00a0/u.test(char)) {
            const point = char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0");
            add("hidden_character", file, `has hidden character U+${point}. Fix: remove it.`, { key, line });
          }
        }
        if (/<\/?[a-z][^>]*>|<!--[\s\S]*?-->|&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i.test(text))
          add("markup_in_value", file, "contains markup. Fix: use plain text.", { key });
        if (/\b(?:https?:\/\/|ftp:\/\/|mailto:|www\.)/i.test(text))
          add(
            "web_address_in_value",
            file,
            "contains an address. Fix: words files hold no addresses; keep the address in code.",
            { key },
          );
        const stripped = text.replace(/\{[a-z][A-Za-z0-9]*\}/g, "");
        if (/[{}]/.test(stripped))
          add("bad_placeholder", file, "has a broken placeholder. Fix: use a name such as {name}.", { key });
        if (file !== english.file && placeholders(text).some((part) => !expectedAll.has(part)))
          add(
            "unknown_placeholder",
            file,
            "has a placeholder not in English. Fix: use the English placeholders.",
            { key },
          );
        if (
          (code === "en" || code === "id") &&
          !allowlist.some((entry) => entry.key === key && entry.text === text)
        ) {
          if (
            /\b(?:consent|trigger|payload|connector|mcp|harness|api key|token|hash|prompt|sandbox|json|digest|schema|stdio|runner|ipc)\b/i.test(
              text,
            )
          )
            add("forbidden_word", file, "contains a technical word. Fix: use plain words.", { key });
          if (/\b(?:run-[\da-f]{6,}|[a-z]+-\d{12})\b/i.test(text))
            add("run_id_in_value", file, "contains a run id. Fix: remove it.", { key });
          if (/\b(?:\d+\.\d+\.\d+|v\d+)\b/i.test(text))
            add("version_in_value", file, "contains a version number. Fix: remove it.", { key });
        }
      }
      if (!english.words.has(key)) {
        add(
          "extra_key",
          file,
          `this key is not in English. Fix: remove ${key} from ${file}, or add it to ${englishFile} first.`,
          { key },
        );
        continue;
      }
      if (typeof word !== "string") {
        if (!("other" in word))
          add(
            "missing_other_form",
            file,
            "the plural value has no other form. Fix: add other, which is the fallback for every count.",
            { key },
          );
        const categories: string[] = pluralCategories(code);
        for (const form of Object.keys(word))
          if (!categories.includes(form))
            add(
              "unknown_plural_form",
              file,
              `the plural form ${form} is not used. Fix: use only these forms for ${code}: ${categories.join(", ")}.`,
              { key, form },
            );
      }
      if (file !== english.file) {
        const reference = english.words.get(key);
        const referenceText =
          typeof reference === "string"
            ? reference
            : (reference?.other ?? Object.values(reference ?? {})[0] ?? "");
        const expected = placeholders(referenceText);
        for (const text of typeof word === "string" ? [word] : Object.values(word)) {
          const actual = placeholders(text);
          if (actual.join() !== expected.join()) {
            add(
              "placeholder_mismatch",
              file,
              `has ${actual.join(", ") || "no placeholders"} but English has ${expected.join(", ") || "no placeholders"}. Fix: use ${expected.join(", ") || "no placeholders"}.`,
              { key },
            );
            break;
          }
        }
      }
    }
  }
  const used = new Set(options.lineKeys ?? []);
  const dynamicKeys: string[] = [];
  try {
    const dynamic = await readFile(join(root, languageDir, "dynamic-keys.ts"), "utf8");
    for (const match of dynamic.matchAll(/["']([\w]+\.[\w.]+)["']/g))
      if (match[1]) dynamicKeys.push(match[1]);
    if (dynamic.includes("STATUS_KEYS")) {
      const status = await readFile(join(root, languageDir, "status.ts"), "utf8");
      for (const match of status.matchAll(/["'](status\.[\w.]+)["']/g))
        if (match[1]) dynamicKeys.push(match[1]);
    }
    for (const key of dynamicKeys) used.add(key);
  } catch {
    /* No dynamic keys. */
  }
  for (const dir of sourceDirs)
    for (const path of await files(join(root, dir))) {
      if (path === join(root, languageDir, "check.ts")) continue;
      const text = await readFile(path, "utf8");
      const file = relative(root, path);
      for (const [index, lineText] of text.split("\n").entries()) {
        const calls = [...lineText.matchAll(/\bt\(/g)];
        if (
          calls.length >= 2 &&
          (/\bt\([^;]*\+[^;]*\bt\(/.test(lineText) ||
            /`[^`]*\$\{t\([^`]*\$\{t\(/.test(lineText) ||
            /\[[^;]*\bt\([^;]*\bt\([^;]*\]\.join\(/.test(lineText))
        )
          add(
            "glued_sentence",
            file,
            "joins translated fragments. Fix: make one key for the whole sentence with placeholders.",
            { line: index + 1 },
          );
        for (const match of lineText.matchAll(/\bt\(\s*(?:["']([^"']*)["']\s*\+|`([^`$]*)\$\{)/g)) {
          const prefix = match[1] ?? match[2] ?? "";
          if (!dynamicKeys.some((key) => key.startsWith(prefix)))
            add(
              "dynamic_key_unlisted",
              file,
              "dynamic key is not listed. Fix: list its keys in dynamic-keys.ts.",
              { line: index + 1 },
            );
        }
      }
      for (const match of text.matchAll(/\bt\(\s*["'`]([\w]+(?:\.[\w]+)+)["'`]\s*(?=[,)])/g)) {
        const key = match[1];
        if (!key) continue;
        used.add(key);
        if (!english.words.has(key)) {
          const file = relative(root, path);
          const line = text.slice(0, match.index).split("\n").length;
          add(
            "missing_key_in_english",
            file,
            `used in code but missing in English. Fix: add ${key} to ${englishFile}, or use a key that exists.`,
            { key, line },
          );
        }
      }
    }
  const pending = new Set(options.pendingKeys ?? []);
  for (const key of pending)
    if (!english.words.has(key) || used.has(key))
      add(
        "stale_pending_key",
        join(languageDir, "pending-keys.ts"),
        "pending key is used or missing. Fix: remove it from the pending list.",
        { key },
      );
  for (const key of english.words.keys())
    if (!used.has(key) && !pending.has(key))
      add(
        "unused_english_key",
        englishFile,
        `this English key is unused. Fix: remove ${key} from every language file, or use it with t().`,
        { key },
      );
  return { findings, untranslated };
}
