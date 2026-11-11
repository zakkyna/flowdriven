import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { silenceSqliteWarning } from "../entry.ts";
import { runDemo } from "./demo.ts";

silenceSqliteWarning();
const dbDir = await mkdtemp(join(tmpdir(), "flowdriven-"));
try {
  const result = await runDemo({
    outDir: resolve(import.meta.dirname, "../../../../.workflow/scratch/engine-demo"),
    dbDir,
  });
  for (const file of result.files) console.log(file);
} finally {
  await rm(dbDir, { recursive: true, force: true });
}
