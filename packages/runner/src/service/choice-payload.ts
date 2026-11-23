import { Payload } from "@flowdriven/contracts";

export function validChoicePayload(value: unknown): boolean {
  return Payload.safeParse(value).success;
}
