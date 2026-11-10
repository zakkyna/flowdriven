import {
  Approval,
  budgetStatus,
  FlowManifest,
  HarnessCard,
  isJudgedOnly,
  isReady,
  ReadinessReport,
  RunDetail,
  Settings,
} from "@flowdriven/contracts";
import { describe, expect, test } from "vitest";
import { buildEmpty, buildLong, buildStory } from "./index";

const story = buildStory();

describe("sample story", () => {
  test("has the five example flows in build order", () => {
    expect(story.flows.map((f) => f.manifest.name)).toEqual([
      "Documents and reports",
      "Figma to Flutter",
      "Email triage and draft replies",
      "Lead follow-up",
      "One source into many social posts",
    ]);
    for (const f of story.flows) FlowManifest.parse(f.manifest);
  });
  test("every flow keeps the spec's flow rules", () => {
    for (const { manifest } of story.flows) {
      const reqIds = new Set(manifest.requirements.map((r) => r.id));
      const stepIds = manifest.steps.map((s) => s.id);
      expect(new Set(stepIds).size).toBe(stepIds.length);
      for (const s of manifest.steps) {
        for (const u of s.uses) expect(reqIds.has(u)).toBe(true);
        expect(s.checks.some((c) => c.required)).toBe(true);
      }
      if (manifest.kind === "light")
        expect(manifest.steps.at(-1)?.checks.some((c) => c.type === "user")).toBe(true);
    }
    const docs = story.flows[0]?.manifest.steps.find((s) => s.id === "cross-check");
    expect(docs && isJudgedOnly(docs.checks)).toBe(true);
  });
  test("runs cover done, blocked, waiting, interrupted and failed", () => {
    for (const r of story.runs) RunDetail.parse(r);
    expect(new Set(story.runs.map((r) => r.state))).toEqual(
      new Set(["waiting_approval", "blocked", "done", "interrupted", "failed"]),
    );
    const figma = story.runs.find((r) => r.id === "run-0006");
    const build = figma?.steps.find((s) => s.stepId === "build-screens");
    expect(build?.checks.find((c) => c.summary === "flutter analyze exits 0")?.evidence).toMatch(
      /^flutter analyze: 3 errors/,
    );
    expect(story.runs.find((r) => r.id === "run-0002")).toMatchObject({
      oneTime: true,
      report: { saveOffer: true },
    });
  });
  test("five approvals wait, three of them similar sends", () => {
    for (const a of story.approvals) Approval.parse(a);
    const pending = story.approvals.filter((a) => a.state === "pending");
    expect(pending.map((a) => a.id).sort()).toEqual(["ap-0011", "ap-0012", "ap-0013", "ap-0014", "ap-0015"]);
    expect(pending.filter((a) => a.similarGroup === "run-0007:send")).toHaveLength(3);
  });
  test("the social posts checklist shows every readiness state", () => {
    const report = ReadinessReport.parse(story.readiness["dev.example.social-posts"]);
    expect(new Set(report.items.map((i) => i.state))).toEqual(
      new Set(["ok", "missing", "needs_login", "failed"]),
    );
    expect(report.ready).toBe(isReady(report.items));
    expect(report.items.find((i) => i.requirementId === "ffmpeg")).toMatchObject({
      autoInstall: "yes",
      installCommand: "brew install ffmpeg",
    });
    expect(report.items.find((i) => i.requirementId === "tiktok-browser")).toMatchObject({
      required: false,
      route: { risk: "unofficial" },
    });
  });
  test("harnesses carry every risk label and two are not found", () => {
    for (const h of story.harnesses) HarnessCard.parse(h);
    expect(new Set(story.harnesses.map((h) => h.risk))).toEqual(new Set(["official", "gray", "unofficial"]));
    expect(story.harnesses.find((h) => h.id === "antigravity")).toMatchObject({
      vendorProhibited: true,
      consent: "not_given",
    });
    expect(story.harnesses.filter((h) => !h.detected).map((h) => h.id)).toEqual(["copilot", "gemini"]);
  });
  test("the budget sits at the 80% badge", () => {
    expect(budgetStatus(Settings.parse(story.settings).budget).level).toBe("warn");
  });
  test("the long scenario adds a very long flow name and a 4,000-character email", () => {
    const long = buildLong();
    expect(long.flows).toHaveLength(6);
    const flow = long.flows.at(-1);
    expect(FlowManifest.parse(flow?.manifest).name.length).toBeGreaterThan(100);
    ReadinessReport.parse(long.readiness["dev.example.quarterly-compliance-review"]);
    const approval = Approval.parse(long.approvals.find((a) => a.id === "ap-0016"));
    expect(approval.payload).toMatchObject({ kind: "email" });
    const email = approval.payload.kind === "email" ? approval.payload : undefined;
    expect(email?.to).toHaveLength(16);
    expect(email?.body.length).toBeGreaterThan(4000);
    expect(email?.body).toContain(String.fromCodePoint(0x202e));
    expect(buildStory().flows).toHaveLength(5);
  });
  test("the empty scenario is empty and valid", () => {
    const empty = buildEmpty();
    expect([empty.flows, empty.runs, empty.approvals, empty.harnesses].every((l) => l.length === 0)).toBe(
      true,
    );
    expect(Settings.parse(empty.settings).budget.capUsd).toBe(0);
  });
});
test("passed sample steps record their first attempt", () => {
  for (const run of story.runs)
    for (const step of run.steps) {
      if (step.state === "passed") expect(step.attempts[0]?.number).toBe(1);
    }
});

test("risky flows explain their approval and story content describes the work", () => {
  for (const { manifest, playback } of story.flows) {
    if (manifest.steps.some((step) => step.risky?.length))
      expect(playback.asksApprovalFor.length).toBeGreaterThan(0);
    expect(manifest.summary).not.toBe(manifest.name);
    for (const requirement of manifest.requirements) {
      expect(requirement.why).not.toMatch(/^Provides .* for this flow\.$/);
      if (requirement.type === "account" || requirement.id === "mail")
        expect(requirement.sensitive).toBe(true);
    }
    for (const step of manifest.steps) {
      expect(step.instructions).not.toBe(`${step.title} for this flow.`);
      for (const check of step.checks) expect(check.summary).not.toBe(`${step.title}: ${check.type} check`);
    }
  }
  const email = story.flows.find((flow) => flow.manifest.id.endsWith("email-triage"));
  expect(email?.manifest.steps.find((step) => step.id === "send-approved")?.uses).toContain("mail");
  const social = story.flows.find((flow) => flow.manifest.id.endsWith("social-posts"));
  expect(social?.manifest.steps.find((step) => step.id === "publish")?.uses).toContain("instagram");
  const items = Object.values(story.readiness).flatMap((report) => report.items);
  for (const item of items.filter((item) => item.state !== "ok"))
    expect(item.guide.steps[0]).not.toMatch(/^Set up /);
  expect(items.some((item) => item.enforcement === "enforced by FlowDriven")).toBe(true);
});

test("sample runs have evidence, workers, complete timing and relevant artifacts", () => {
  for (const run of story.runs) {
    if (run.state === "done" || run.state === "failed") expect(run.endedAt).toBeTruthy();
    for (const step of run.steps) {
      if (step.do === "worker" && step.attempts.length) expect(step.worker?.name).toBeTruthy();
      for (const attempt of step.attempts) {
        expect(attempt.number).toBeGreaterThan(0);
        expect(attempt.endedAt).not.toBe(attempt.startedAt);
      }
      for (const check of step.checks) if (check.verdict === "passed") expect(check.evidence).toBeTruthy();
    }
  }
  const attempts = story.runs.find((run) => run.id === "run-0006")?.steps[2]?.attempts ?? [];
  expect(new Set(attempts.map((attempt) => attempt.startedAt)).size).toBe(attempts.length);
  const report = story.runs.find((run) => run.id === "run-0005");
  expect(report?.inputs.length).toBeGreaterThan(0);
  expect(report?.outputs.map((output) => output.value)).toEqual(
    expect.arrayContaining([expect.stringContaining("report.docx"), expect.stringContaining("report.md")]),
  );
  const once = story.runs.find((run) => run.id === "run-0002");
  expect(once?.steps[0]?.checks[0]?.summary).toMatch(/screenshot/i);
});

test("detection-only harnesses have unknown login", () => {
  expect(story.harnesses.find((h) => h.id === "opencode")?.login).toBe("unknown");
});
test("hidden characters belong to the second paragraph", () => {
  const approval = buildLong().approvals.find((a) => a.id === "ap-0016");
  if (approval?.payload.kind !== "email") throw new Error("Missing email");
  const paragraphs = approval.payload.body.split("\n\n");
  for (const cp of [0x202e, 0x200b]) expect(paragraphs[1]).toContain(String.fromCodePoint(cp));
});
test("unstarted and skipped steps do not have workers", () => {
  for (const [id, stepId] of [
    ["run-0006", "visual-review"],
    ["run-0004", "make-media"],
  ]) {
    const step = story.runs.find((r) => r.id === id)?.steps.find((s) => s.stepId === stepId);
    expect(step?.attempts).toHaveLength(0);
    expect(step?.worker).toBeUndefined();
  }
});
