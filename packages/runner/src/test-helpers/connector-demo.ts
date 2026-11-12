#!/usr/bin/env node
import { runConnectorDemo } from "./connector-demo-run.ts";

for (const line of await runConnectorDemo()) process.stdout.write(`${line}\n`);
