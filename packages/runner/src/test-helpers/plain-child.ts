import { openSqliteStore } from "../sqlite-store.ts";

(await openSqliteStore(":memory:")).close();
