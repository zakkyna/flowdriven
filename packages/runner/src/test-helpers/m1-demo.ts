#!/usr/bin/env node
import { runM1Demo } from "./m1-demo-run.ts";

for (const line of await runM1Demo()) process.stdout.write(`${line}\n`);
