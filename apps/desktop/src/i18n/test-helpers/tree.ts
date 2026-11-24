import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const BASE = {
  "lang/en.ts": `export default { code: "en", name: "English", words: { a: { used: "Used", one: "One {n}", two: { one: "{n} item", other: "{n} items" } } } };`,
  "lang/id.ts": `export default {\n code: "id",\n name: "Indonesia",\n words: { a: {\n used: "Dipakai",\n one: "Satu {n}", two: { other: "{n} butir" } } } };`,
  "lang/languages.ts": `import en from "./en"; import id from "./id"; export const languages = [en, id];`,
  "src/app.ts": `t("a.used");\nt("a.one");\nt("a.two");`,
};
export async function tree(changes: Record<string, string> = {}) {
  const scratch = join(process.cwd(), ".workflow/scratch");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "flow-i18n-"));
  for (const [file, contents] of Object.entries({ ...BASE, ...changes })) {
    await mkdir(join(root, file, ".."), { recursive: true });
    await writeFile(join(root, file), contents);
  }
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}
export function language(code: string, words: string) {
  return `export default { code: "${code}", name: "Test", words: { a: { ${words} } } };`;
}
