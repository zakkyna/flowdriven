#!/usr/bin/env node
import { runBrowserDemo } from "./browser-demo-run.ts";

for (const line of await runBrowserDemo()) process.stdout.write(`${line}\n`);
