import { DatabaseSync } from "node:sqlite";
import { openSqliteStore } from "../sqlite-store.ts";

process.removeAllListeners("warning");
const path = process.argv[2];
try {
  if (path === undefined) throw new Error("Missing database path.");
  const store =
    process.argv[3] === "lock-only"
      ? new DatabaseSync(path)
      : await openSqliteStore(path, { exclusive: true });
  if (store instanceof DatabaseSync) store.exec("PRAGMA locking_mode=EXCLUSIVE; BEGIN IMMEDIATE;");
  process.stdout.write("locked\n");
  process.stdin.resume();
  process.stdin.on("end", () => {
    store.close();
    process.exit(0);
  });
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "The data folder could not be opened."}\n`,
  );
  process.exit(3);
}
