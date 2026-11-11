import { silenceSqliteWarning } from "../entry.ts";
import { openSqliteStore } from "../sqlite-store.ts";

silenceSqliteWarning();
(await openSqliteStore(":memory:")).close();
process.emitWarning("keep me");
