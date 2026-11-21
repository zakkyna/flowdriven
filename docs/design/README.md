# FlowDriven real-app design set

This folder is the design for building FlowDriven's real app after the clickable prototype: what the app must do, how each journey works, how the app is built, how it stays safe, and how test-driven development drives every build step.

Status: complete design for the V1 build, 2026-11-21. It follows version 9 of the clickable prototype: version 8 plus the language setting, one file per language and the AI agent and model picker. Decisions the owner did not make are recorded as "Decided for V1 (revisable)". The V1 behaviours the owner has not seen in the prototype are listed once, in the PRD's register (`prd.md` section 9.1).

Size: 25 features with 226 requirements (2 of them removed from V1 and kept as ids), 54 quality targets and 13 success measures; 14 flow specs; 1,276 test cases (576 journey, 177 safety, 523 component); 32 build steps in 206 tasks (V1: 26 steps, 179 tasks); 29 V1 behaviours not yet in the prototype (PU-01 to PU-29).

## What is where

| Document | What it answers | Ids it owns |
|---|---|---|
| [prd.md](prd.md) | What the app does for whom, every feature, the safety promises, quality targets, success measures, the V1 scope and the decisions for V1 | `F-01`..`F-25`, `NF-*`, `M-*`, `Q-01`..`Q-04`, `PU-01`..`PU-29` |
| [flows/README.md](flows/README.md) and 14 flow specs | How each journey of the prototype's Guide works: entry points, steps, states, decisions, errors, acceptance criteria | `FS-j01`..`FS-j31` |
| [architecture.md](architecture.md) | The safety rules, the architecture decisions, processes, modules, the safety core, agents, starts and schedules, words and languages, migration from today's code | `SR-1`..`SR-9`, `START`, `AD-*` |
| [data-model.md](data-model.md) | Entities, store tables, the migration from store version 6, retention | - |
| [runner-api.md](runner-api.md) | Runner API contract version 2: operations, cards, events, errors, the IPC layer | - |
| [threat-model.md](threat-model.md) | Assets, trust boundaries, actors, threats and their mitigations, review gates | `T-*` |
| [test-plan.md](test-plan.md) | The TDD loop, test layers, rules, fakes, traceability and coverage rules | - |
| [test-cases/journeys.md](test-cases/journeys.md) | Test cases for every flow spec | `TC-jNN-*` |
| [test-cases/safety.md](test-cases/safety.md) | Test cases for every safety rule and the start rule | `TC-SRn-*`, `TC-START-*` |
| [test-cases/platform.md](test-cases/platform.md) | Test cases for every component | `TC-<COMPONENT>-*` |
| [build-order.md](build-order.md) | The build steps in order, split into tasks of one Codex call, each with the tests that must fail first, what the owner can try, and the version they belong to | `B-00`..`B-31` |
| [contributing-plan.md](contributing-plan.md) | The contributor guides for people who code by hand and for AI agents (README quickstart, CONTRIBUTING.md, AGENTS.md, docs/translating.md) | - |

## Reading order

- The owner: the PRD's sections on users, features, safety promises, the V1 scope, the register of V1 behaviours not yet seen in the prototype and the decisions for V1.
- Builders: PRD, then the flow specs of the journey being built, then the architecture, data model and runner API, then the threat model, then the test plan, test cases and build order.

## Precedence

1. The owner's decisions, as shown in the prototype the owner tried and approves.
2. This design set.
3. The original spec, `docs/superpowers/specs/2026-11-10-flow-maker-design.md`, where this set does not replace it. Its binding safety rules (the original 15.2 protections and R1 to R20) stay in force unless `architecture.md` says how a rule changes.

AGENTS.md still names the original spec as the design. Pointing it here is an Ask-first change, for after the owner approves this set.

## How this set is used

- Prototype first: a journey is built only after the owner approves it in the prototype. Each build step names the `PU-nn` items of the PRD's register that the owner must approve in the prototype before the step starts.
- Each build plan in `docs/plans/` names its build step (`B-*`), the flow specs it implements and the test case ids that must fail first. Plans stay about one page and contain no code.
- A change to the product goes into the prototype first, then into the flow spec and its test cases, then into code.
- Parts marked "Not in the prototype yet" go into the prototype before they are built.

## Id map

| Prefix | Meaning | Defined in |
|---|---|---|
| `F-` | Feature | prd.md |
| `PU-` | A V1 behaviour the owner has not seen in the prototype | prd.md |
| `NF-` | Non-functional requirement | prd.md |
| `M-` | Success measure | prd.md |
| `Q-` | Decision for V1 (revisable) | prd.md |
| `FS-jNN` | Flow spec for journey jNN (steps `.S`, other paths `.P`, errors `.E`, acceptance criteria `.A`) | flows/ |
| `SR-`, `START` | Safety rule, start rule | architecture.md |
| `AD-` | Architecture decision | architecture.md |
| `T-` | Threat | threat-model.md |
| `TC-` | Test case | test-cases/ |
| `B-` | Build step (tasks `B-NN.T1`, `B-NN.T2`, ...) | build-order.md |
