import "../config.ts";
import { flow } from "./flows.ts";

export const flowV12 = (overrides: Record<string, unknown> = {}) => ({
  ...flow(),
  format: "flowdriven-flow/1.2",
  inputs: [{ id: "start", label: "Start time", type: "time", default: "now" }],
  ...overrides,
});
export const flowV12Yaml = (overrides: Record<string, unknown> = {}) => JSON.stringify(flowV12(overrides));
