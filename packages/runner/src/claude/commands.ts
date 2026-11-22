import { commandLineAllowed, parseCommandLine } from "@flowdriven/sdk";
import { commandRefusal } from "../router/commands-route.ts";

export type CommandPolicy = { patterns: string[] };
export const COMMAND_DENY = {
  notDeclared: "This step does not declare this command.",
  badInput: "FlowDriven does not accept this command call.",
  background: "A command may not run in the background.",
};
export const COMMAND_STOP = {
  outside: "A step that reads outside text cannot run commands. Run them in a step of their own.",
  noFolder: "A step that runs commands needs a folder to run them in.",
};
export function decideCommand(
  policy: CommandPolicy | undefined,
  input: Record<string, unknown>,
): { allow: true } | { allow: false; reason: string } {
  if (input.run_in_background === true) return { allow: false, reason: COMMAND_DENY.background };
  if (
    Object.keys(input).some(
      (key) =>
        !["command", "description", "timeout", "run_in_background", "dangerouslyDisableSandbox"].includes(
          key,
        ),
    ) ||
    typeof input.command !== "string" ||
    ("description" in input && (typeof input.description !== "string" || input.description.length > 500)) ||
    ("timeout" in input &&
      (typeof input.timeout !== "number" ||
        !Number.isInteger(input.timeout) ||
        input.timeout < 1 ||
        input.timeout > 600000)) ||
    ("run_in_background" in input && input.run_in_background !== false) ||
    ("dangerouslyDisableSandbox" in input && input.dangerouslyDisableSandbox !== false)
  )
    return { allow: false, reason: COMMAND_DENY.badInput };
  const parsed = parseCommandLine(input.command);
  if (!parsed.ok) return { allow: false, reason: COMMAND_DENY.badInput };
  if (!policy || !commandLineAllowed(policy.patterns, parsed.words))
    return { allow: false, reason: COMMAND_DENY.notDeclared };
  const matched = policy.patterns.filter((pattern) => commandLineAllowed([pattern], parsed.words));
  const reason =
    commandRefusal(parsed.words.join(" ")) ?? matched.map(commandRefusal).find((item) => item !== undefined);
  return reason ? { allow: false, reason } : { allow: true };
}
