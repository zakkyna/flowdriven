#!/usr/bin/env node
import { runTriggerDemo } from "./trigger-demo-run.ts";

for (const line of await runTriggerDemo()) process.stdout.write(`${line}\n`);
