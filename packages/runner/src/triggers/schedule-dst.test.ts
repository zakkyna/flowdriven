import { spawnSync } from "node:child_process";
import { execPath } from "node:process";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";

function inZone(zone: string, body: string): unknown {
  const url = pathToFileURL(new URL("./schedule.ts", import.meta.url).pathname).href;
  const script = `import { dueSlots, slotKey } from ${JSON.stringify(url)}; ${body}`;
  const result = spawnSync(execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, TZ: zone, NODE_OPTIONS: "" },
    encoding: "utf8",
  });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as unknown;
}

test("America/New_York: at 02:30 on the spring-forward day 2026-03-08 gives one slot (03:30 EDT) and the key is that date, and at 01:30 on 2026-11-01 gives one slot, not two", () => {
  expect(
    inZone(
      "America/New_York",
      `
    const spring = dueSlots({at:"02:30"}, {afterMs:+new Date(2026,2,8,0), uptoMs:+new Date(2026,2,8,23), anchorMs:0});
    const fall = dueSlots({at:"01:30"}, {afterMs:+new Date(2026,10,1,0), uptoMs:+new Date(2026,10,1,23), anchorMs:0});
    process.stdout.write(JSON.stringify({spring, springKey:slotKey({at:"02:30"}, spring.latest), fall, fallKey:slotKey({at:"01:30"}, fall.latest)}));
  `,
    ),
  ).toEqual({
    spring: { slots: 1, latest: Date.parse("2026-03-08T07:30:00Z"), capped: false },
    springKey: "at:2026-03-08",
    fall: { slots: 1, latest: Date.parse("2026-11-01T05:30:00Z"), capped: false },
    fallKey: "at:2026-11-01",
  });
});
test("every 1h between 2026-03-07 09:00 and 2026-03-09 09:00 local counts 47 slots in America/New_York and 48 in Asia/Jakarta", () => {
  const body = `const start = +new Date(2026,2,7,9); const end = +new Date(2026,2,9,9); process.stdout.write(JSON.stringify(dueSlots({everyMs:3600000}, {afterMs:start, uptoMs:end, anchorMs:start}).slots));`;
  expect(inZone("America/New_York", body)).toBe(47);
  expect(inZone("Asia/Jakarta", body)).toBe(48);
});
