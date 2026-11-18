import { fileURLToPath } from "node:url";

export const M1_FLOW_DIR = fileURLToPath(
  new URL("../../../fixtures/flows/upwork-job-review/", import.meta.url),
);
