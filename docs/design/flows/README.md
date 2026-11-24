# Flow specs

One flow spec describes one journey of the clickable prototype's Guide as the real app must behave. A flow spec is the bridge between the product requirements (`../prd.md`), the safety rules (`../architecture.md`), the test cases (`../test-cases/journeys.md`) and the build steps (`../build-order.md`). It says what the person does, what FlowDriven does, what the person sees, and how each failure ends. It contains no code.

## What a flow spec is

- It follows one journey from its trigger to its end: the main path first, then other paths, then errors.
- It names exact English UI words in quotes, taken from the prototype (except the sample names, see "Generic names" below), and names states with the words from the design vocabulary (`waiting_approval`, `needs_login`, `confirmed`, `changed`, `approved_edited`).
- It says what asks, what confirms and what deliberately does not.
- It lists the runner operations it uses (names from `../runner-api.md`) and the data it reads and writes (names from `../data-model.md`).
- It ends with testable acceptance criteria. Every criterion has at least one test case.
- Where the prototype has a gap, the spec says what the real app does instead. Where the real app adds behavior the owner has not tried, the spec marks it "Not in the prototype yet" and lists it by its `PU-nn` id from the register of V1 behaviours the owner has not seen (in `../prd.md`), so it goes into the prototype before it is built. What the owner has not seen and V1 drops is listed as "Removed from V1" and goes into the prototype first, later.
- Where a path or criterion leaves V1, it keeps its id and reads "(Removed from V1: ...)", or it is rewritten to the V1 behaviour.
- V1 means V1 (build steps B-01 to B-24). Memory, Phone & bots and skill updates are V2. Marketplace and the gateway are V3.

## Template

Every file has these parts in this order:

1. Title `# FS-jNN: <English title>`. Version 9 of the clickable prototype is final, so no pending line is written.
2. A table: Journey (id, Indonesian title from the Guide, English title), PRD features, Safety rules (SR ids, `START`), Prototype source (the prototype brief cited by section title only, never by number, and the prototype files), Status.
3. `## Goal`: one or two sentences.
4. `## Entry points and trigger`.
5. `## Preconditions`.
6. `## Main path`: steps with `Person:`, `FlowDriven:` and `Sees:`.
7. `## Other paths`.
8. `## States`: a table of entity, from -> to, cause.
9. `## Decisions and confirmations`: what asks, what confirms, what deliberately does not.
10. `## Errors and edge cases`: cause, what the person sees, what happens next. Always covered: agent not set up or signed out, permission off, limits reached, a stopped or failed run, a crash or restart, a flow changed since it was confirmed, outside text trying to steer the agent, a decision that waits for an answer, and the prototype gaps for the journey. An item that cannot happen in the journey gets a short entry "Not applicable because ..." instead of being left out.
11. `## Data read and written`.
12. `## Runner API used`: operation names and topics.
13. `## Acceptance criteria`.
14. `## Not in the prototype yet` (if any).
15. `## Drafter's calls`: judgments the spec made where the brief was silent, one line each with the reason. A choice is marked "Decided for V1 (revisable)"; decisions belong to the owner, so write "owner", never "chair", for a decision (the AGENTS.md term "Chair step" stays).

## Id rules

| Id | Meaning | Example |
|---|---|---|
| `FS-jNN` | The flow spec of journey `jNN` | `FS-j24` |
| `FS-jNN.S<n>` | A step of the main path | `FS-j24.S3` |
| `FS-jNN.P<n>` | Another path | `FS-j24.P5` |
| `FS-jNN.E<n>` | An error or edge case | `FS-j24.E7` |
| `FS-jNN.A<n>` | An acceptance criterion | `FS-j24.A12` |
| `F-nn` | A product feature in `../prd.md` | `F-13` |
| `SR-n` | A safety rule in `../architecture.md` | `SR-1` |
| `START` | The start rule in `../architecture.md` (section "Starts") | `START` |
| `B-nn` | A build step in `../build-order.md` | `B-05` |
| `TC-jNN-nn` | A test case for the journey in `../test-cases/journeys.md` | `TC-j24-07` |

Numbers never change once used. A removed item leaves its number unused. The journey id comes from the prototype's Guide (j01 to j31).

## Generic names and the time zone

Specs, fixtures and test cases use generic, product-neutral names, and these are the names the build uses: "cloud storage" for any file storage service, `timesheet-skill` for the timesheet skill, "the timesheet service" for the timesheet account, "Job review", and "Project Example" and "Example Corp" for projects and customers. Where the clickable prototype shows another name, the name in the specs is the one to build. Examples use the time zone `Asia/Bangkok` (UTC+07:00, no daylight saving), "Bangkok" for the city; addresses use `example.test` or `example.com` only. The only non-ASCII character allowed in these files is the middle dot in "Claude Code · Sonnet 5.5".

## How specs map to the other documents

- PRD features: each spec lists its feature ids in its table. The PRD's feature table lists the journeys for each feature. The two must agree.
- Safety rules: each spec lists the SR ids it touches. A rule that a journey touches has at least one test case in that journey's section and in `../test-cases/safety.md`.
- Test cases: every `FS-jNN.A<n>` is cited by at least one `TC-jNN-nn` through its `Traces:` line. The main path, each error case and each safety rule of the journey also have cases.
- Build steps: each criterion is built by a step in `../build-order.md`. The step lists the test cases that fail first. The table below gives the main steps per journey.

| Journey | Main build steps |
|---|---|
| j01 | B-21, B-07 |
| j12 | B-20, B-24, B-07, B-06 |
| j20 | B-08, B-10, B-11, B-16, B-17 |
| j21 | B-12, B-18 |
| j22 | B-13, B-08 |
| j23 | B-14, B-08 |
| j24 | B-04, B-05, B-19 |
| j25 | B-19, B-23 |
| j26 | B-25, B-26, B-27, B-28 |
| j27 | B-09, B-11 |
| j28 | B-12, B-23 |
| j29 | B-15, B-13 |
| j30 | B-06 |
| j31 | B-07, B-17 |

## Index of flow specs

| Id | File | Title | Features | Status |
|---|---|---|---|---|
| j01 | `j01-first-launch.md` | First launch and agent set up | F-01 | In the prototype (version 8) |
| j12 | `j12-settings.md` | Settings | F-15, F-23, F-02 | In the prototype (version 8); parts Not in the prototype yet |
| j20 | `j20-run-from-chat.md` | Run flows from the chat | F-02, F-03, F-04, F-06 | In the prototype (version 8) |
| j21 | `j21-run-from-flows.md` | Run from the Flows list | F-07, F-08, F-09 | In the prototype (version 8); parts Not in the prototype yet |
| j22 | `j22-make-a-flow.md` | Make a new flow in the chat | F-10 | In the prototype (version 8); parts Not in the prototype yet |
| j23 | `j23-improve-a-flow.md` | Improve a flow | F-11 | In the prototype (version 8); parts Not in the prototype yet |
| j24 | `j24-decisions.md` | Things that need your decision | F-13, F-16 | In the prototype (version 8); parts Not in the prototype yet |
| j25 | `j25-history-and-problems.md` | History and problems | F-14, F-23 | In the prototype (version 8); parts Not in the prototype yet |
| j26 | `j26-memory-phone-marketplace.md` | Memory, Phone & bots, Marketplace (and Skills screen basics) | F-17, F-18, F-19, F-24, F-12 | In the prototype (version 8) as demos; real behavior Not in the prototype yet (V2, V3) |
| j27 | `j27-flow-inputs.md` | A flow that needs details from you | F-03, F-05, F-06 | In the prototype (version 8) |
| j28 | `j28-proactive-schedule.md` | A schedule that asks first | F-08, F-09, F-16, F-22 | In the prototype (version 8); parts Not in the prototype yet |
| j29 | `j29-flow-from-skill.md` | Make a flow from a skill | F-12 | In the prototype (version 8); parts Not in the prototype yet |
| j30 | `j30-app-language.md` | App language | F-20 | In the prototype (version 9) |
| j31 | `j31-agent-and-model.md` | Choose the AI agent and model | F-21 | In the prototype (version 9) |

Each spec's own status line is the source for its journey.
