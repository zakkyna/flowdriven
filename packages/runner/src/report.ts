import type { RunView } from "./engine.ts";
import type { UsageEventRow } from "./storage.ts";

export function sumUsage(rows: UsageEventRow[]) {
  let input = 0,
    output = 0,
    cacheRead = 0,
    cacheWrite = 0,
    turns = 0,
    wallMs = 0,
    queuedMs = 0;
  let reported = false;
  for (const row of rows) {
    turns += row.turns;
    wallMs += row.wallMs;
    queuedMs += row.queuedMs;
    if (row.models.length) reported = true;
    for (const model of row.models) {
      input = Math.min(Number.MAX_SAFE_INTEGER, input + model.input);
      output = Math.min(Number.MAX_SAFE_INTEGER, output + model.output);
      cacheRead = Math.min(Number.MAX_SAFE_INTEGER, cacheRead + model.cacheRead);
      cacheWrite = Math.min(Number.MAX_SAFE_INTEGER, cacheWrite + model.cacheWrite);
    }
  }
  return {
    calls: rows.length,
    input,
    output,
    cacheRead,
    cacheWrite,
    turns,
    wallSeconds: wallMs / 1000,
    queuedSeconds: queuedMs / 1000,
    reported,
  };
}

export function escapeText(text: string, max = 200): string {
  const escaped = text
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\[\]()!*_#]/g, "\\$&")
    .replace(/\|/g, "\\|")
    .replace(/`/g, "'")
    .replace(
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
      (c) => `<U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}>`,
    );
  return [...escaped].length > max ? `${[...escaped].slice(0, max).join("")}...` : escaped;
}
export function reportLines(view: RunView): [string, string, string] {
  const { run, manifest, steps, items, approvals } = view;
  const state = run.state.replaceAll("_", " ");
  const passed = manifest.steps.filter((s) =>
    steps.some((row) => row.stepId === s.id && row.itemKey === "" && row.state === "passed"),
  ).length;
  let last: string;
  if (run.state === "done") last = "Nothing needs your attention.";
  else if (run.state === "waiting_approval") {
    const pending = approvals.find((a) => a.state === "pending");
    if (!pending) throw new Error("Pending approval missing.");
    last = `Waiting for you: ${pending.summary}`;
  } else if (run.state === "blocked") {
    if (run.blockedReason === undefined) throw new Error("Blocked reason missing.");
    last = `Blocked: ${run.blockedReason}`;
  } else if (run.state === "failed")
    last = `Failed: ${steps.find((s) => s.state === "failed" && s.note)?.note ?? run.blockedReason ?? "see the steps"}`;
  else last = `Not finished: ${state}.`;
  return [
    `${manifest.name}: ${state}. ${passed} of ${manifest.steps.length} steps passed.`,
    `Items: ${items.filter((i) => i.status === "passed").length} processed, ${items.filter((i) => i.note === "skipped: seen in an earlier run").length} skipped as seen, ${items.filter((i) => i.status === "failed").length} failed.`,
    last,
  ];
}
export function renderRunReport(view: RunView): string {
  const { run, manifest, steps, items, approvals, audit } = view;
  const e = escapeText;
  const lines = [
    `# ${e(manifest.name)}: run ${e(run.id)}`,
    "",
    `- State: ${e(run.state)}`,
    `- Flow: ${e(run.flowId)} ${e(run.flowVersion)}`,
    `- Hash: ${e(run.flowHash)}`,
    `- Trigger: ${e(run.trigger?.kind ?? "manual")}`,
    `- Started: ${e(run.startedAt)}`,
    `- Ended: ${e(run.endedAt ?? "-")}`,
    "",
    "## Summary",
    "",
    ...reportLines(view).map((line) => e(line)),
    "",
    "## Inputs",
    "",
  ];
  const inputs = [...Object.entries(run.inputs), ...Object.entries(run.params)];
  lines.push(
    ...(inputs.length ? inputs.map(([id, value]) => `- ${e(id)}: ${e(JSON.stringify(value))}`) : ["- none"]),
  );
  lines.push(
    "",
    "## Steps",
    "",
    "| Step | State | Worker | Attempts | Checks |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const step of manifest.steps) {
    const row = steps.find((s) => s.stepId === step.id && s.itemKey === "");
    const required = row?.checks.filter((c) => c.required) ?? [];
    const checks =
      (row?.checks.map((c) => `${c.type}: ${c.verdict}`).join(", ") || "-") +
      (required.length && required.every((c) => c.type === "judge") ? " (judged, not verified)" : "");
    lines.push(
      `| ${e(step.id)} | ${e(row?.state ?? "-")} | ${e(row?.attempts.at(-1)?.worker ?? "-")} | ${row?.attempts.length ?? 0} | ${e(checks)} |`,
    );
  }
  lines.push("", "### Evidence", "");
  const evidence = steps.flatMap((s) =>
    s.checks
      .filter((c) => c.verdict === "failed" || c.type === "judge")
      .map(
        (c) => `- ${e(s.stepId)}${s.itemKey ? `@${e(s.itemKey)}` : ""} ${e(c.type)}: ${e(c.evidence ?? "-")}`,
      ),
  );
  const attemptEvidence = steps.flatMap((s) =>
    (s.attemptLog ?? []).map(
      (entry) =>
        `- ${e(s.stepId)}${s.itemKey ? `@${e(s.itemKey)}` : ""} attempt ${entry.attempt} ${e(entry.reason)} (${entry.count}): ${e(entry.evidence || "-")}`,
    ),
  );
  const allEvidence = [...evidence, ...attemptEvidence];
  lines.push(...(allEvidence.length ? allEvidence : ["- none"]));
  for (const loop of manifest.steps.filter((s) => "for_each" in s)) {
    lines.push(
      "",
      `## Items: ${e(loop.id)}`,
      "",
      "| Key | Status | Steps | Note |",
      "| --- | --- | --- | --- |",
    );
    for (const item of items.filter((i) => i.loopId === loop.id)) {
      const nested = loop.steps
        .map((s) => {
          const row = steps.find((r) => r.stepId === s.id && r.itemKey === item.key);
          return row ? `${s.id} ${row.state}` : "";
        })
        .filter(Boolean)
        .join(", ");
      lines.push(`| ${e(item.key)} | ${e(item.status)} | ${e(nested || "-")} | ${e(item.note ?? "-")} |`);
    }
  }
  lines.push("", "## Choices", "");
  const choices = approvals
    .filter((a) => a.kind === "ask")
    .map((a) => {
      const payload = a.payload;
      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        !Array.isArray(payload.options)
      )
        throw new Error("Invalid choice payload.");
      const options = payload.options.map((o) => {
        if (!o || typeof o !== "object" || Array.isArray(o) || typeof o.key !== "string")
          throw new Error("Invalid choice option.");
        return o.key;
      });
      return `- ${e(a.summary)}; options: ${e(options.join(", ") || "-")}; picked: ${e(a.picks?.join(", ") || "-")}; ${e(a.state)}`;
    });
  lines.push(...(choices.length ? choices : ["- none"]), "", "## Outputs", "");
  const outputs = manifest.steps.flatMap((s) => {
    if ("for_each" in s) return [];
    const row = steps.find((r) => r.stepId === s.id && r.itemKey === "");
    return s.outputs
      .filter((o) => row && Object.hasOwn(row.outputs, o.id))
      .map((o) => `- ${e(s.id)}.${e(o.id)}: ${e(JSON.stringify(row?.outputs[o.id]))}`);
  });
  lines.push(...(outputs.length ? outputs : ["- none"]), "", "## Usage", "");
  const usage = view.usage ?? [];
  if (!usage.some((row) => row.models.length > 0)) lines.push("- not reported");
  else {
    lines.push(
      "| Step | Calls | Input | Output | Cache read | Cache write | Turns | Seconds | Queued |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    const groups: { stepId: string; itemKey: string; rows: UsageEventRow[] }[] = [];
    for (const row of usage) {
      let group = groups.find((g) => g.stepId === row.stepId && g.itemKey === row.itemKey);
      if (!group) {
        group = { stepId: row.stepId, itemKey: row.itemKey, rows: [] };
        groups.push(group);
      }
      group.rows.push(row);
    }
    const line = (name: string, rows: UsageEventRow[]) => {
      const u = sumUsage(rows);
      return `| ${[name, u.calls, u.input, u.output, u.cacheRead, u.cacheWrite, u.turns, u.wallSeconds.toFixed(1), u.queuedSeconds.toFixed(1)].map((cell) => e(String(cell))).join(" | ")} |`;
    };
    for (const group of groups)
      lines.push(line(group.stepId + (group.itemKey ? `@${group.itemKey}` : ""), group.rows));
    lines.push(line("Total", usage));
  }
  lines.push("", "## Audit", "");
  lines.push(
    ...(audit.length
      ? audit.map((a) => `- ${e(a.at)} ${e(a.kind)} ${e(JSON.stringify(a.detail))}`)
      : ["- none"]),
    "",
  );
  return lines.join("\n");
}
