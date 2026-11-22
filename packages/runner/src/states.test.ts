import { RunState, StepRunState } from "@flowdriven/contracts";
import {
  ApprovalState,
  CheckType,
  CheckVerdict,
  ExitClass,
  RequirementType,
  RiskyAction,
} from "@flowdriven/contracts/v1";
import { CHECK_TYPES, REQUIREMENT_TYPES } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import {
  APPROVAL_STATES,
  CHECK_VERDICTS,
  canResume,
  EXIT_CLASSES,
  isActive,
  isEnded,
  RISKY_ACTIONS,
  RUN_STATES,
  STEP_STATES,
} from "./states.ts";

test("TC-ENG-07 engine and SDK vocabularies equal the contract's", () => {
  expect([...RUN_STATES]).toEqual(RunState.options);
  expect([...STEP_STATES]).toEqual(StepRunState.options);
  expect([...APPROVAL_STATES]).toEqual(ApprovalState.options);
  expect([...EXIT_CLASSES]).toEqual(ExitClass.options);
  expect([...CHECK_VERDICTS]).toEqual(CheckVerdict.options);
  expect([...RISKY_ACTIONS]).toEqual(RiskyAction.options);
  expect([...CHECK_TYPES]).toEqual(CheckType.options);
  expect([...REQUIREMENT_TYPES]).toEqual(RequirementType.options);
});

test("TC-ENG-01 run state helpers", () => {
  for (const state of RunState.options) {
    expect([state, isActive(state)]).toEqual([
      state,
      ["queued", "checking", "running", "retrying", "waiting_approval"].includes(state),
    ]);
    expect([state, isEnded(state)]).toEqual([state, ["done", "failed", "stopped"].includes(state)]);
    expect([state, canResume(state)]).toEqual([
      state,
      ["blocked", "interrupted", "needs_login", "failed"].includes(state),
    ]);
  }
});
