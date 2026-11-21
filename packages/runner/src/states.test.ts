import {
  ApprovalState,
  CheckType,
  CheckVerdict,
  ExitClass,
  RequirementType,
  RiskyAction,
  RunState,
  StepRunState,
} from "@flowdriven/contracts/v1";
import { CHECK_TYPES, REQUIREMENT_TYPES } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import {
  APPROVAL_STATES,
  CHECK_VERDICTS,
  EXIT_CLASSES,
  RISKY_ACTIONS,
  RUN_STATES,
  STEP_STATES,
} from "./states.ts";

test("engine and SDK vocabularies equal the contract's", () => {
  expect([...RUN_STATES]).toEqual(RunState.options);
  expect([...STEP_STATES]).toEqual(StepRunState.options);
  expect([...APPROVAL_STATES]).toEqual(ApprovalState.options);
  expect([...EXIT_CLASSES]).toEqual(ExitClass.options);
  expect([...CHECK_VERDICTS]).toEqual(CheckVerdict.options);
  expect([...RISKY_ACTIONS]).toEqual(RiskyAction.options);
  expect([...CHECK_TYPES]).toEqual(CheckType.options);
  expect([...REQUIREMENT_TYPES]).toEqual(RequirementType.options);
});
