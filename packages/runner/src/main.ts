import { silenceSqliteWarning } from "./entry.ts";
import { parseArguments, scrubEnvironment } from "./service/args.ts";
import { guardProcess, runProcess } from "./service/run-process.ts";

silenceSqliteWarning();
scrubEnvironment(process.env);
const errors = (line: string) => {
  process.stderr.write(`${line}\n`);
};
process.stderr.on("error", () => {});
guardProcess(process, errors);
const args = parseArguments(process.argv.slice(2));
if (!args.ok) {
  errors(args.message);
  process.exit(2);
}
process.exit(await runProcess({ ...args.options, input: process.stdin, output: process.stdout, errors }));
