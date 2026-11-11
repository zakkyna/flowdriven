import { expect, test } from "vitest";
import { dueSlots, localDay, nextSlot, scheduleOf, slotKey } from "./schedule.ts";

const H = 3_600_000;
const T0 = Date.parse("2026-11-12T00:00:00.000Z");

test("every: slots follow the anchor in elapsed time, never at the anchor itself, and latest is the newest", () => {
  const spec = { everyMs: H };
  expect(dueSlots(spec, { afterMs: T0, uptoMs: T0, anchorMs: T0 })).toEqual({ slots: 0, capped: false });
  expect(dueSlots(spec, { afterMs: T0, uptoMs: T0 + 3 * H + 5, anchorMs: T0 })).toEqual({
    slots: 3,
    latest: T0 + 3 * H,
    capped: false,
  });
  expect(dueSlots(spec, { afterMs: T0 + 3 * H, uptoMs: T0 + 3 * H + 5, anchorMs: T0 })).toEqual({
    slots: 0,
    capped: false,
  });
});
test("a clock that moved back and a bad spec give no slots and do not throw", () => {
  expect(dueSlots({ everyMs: H }, { afterMs: T0 + H, uptoMs: T0, anchorMs: T0 }).slots).toBe(0);
  for (const spec of [
    {},
    { everyMs: 1, at: "09:00" },
    { everyMs: Number.NaN },
    { everyMs: -5 },
    { at: "9:00" },
    { at: "25:00" },
  ])
    expect(dueSlots(spec, { afterMs: T0, uptoMs: T0 + 9 * H, anchorMs: T0 }).slots).toBe(0);
});
test("days filters by the local weekday for every and for at", () => {
  const w = { afterMs: T0, uptoMs: T0 + 3 * 24 * H, anchorMs: T0 };
  expect(dueSlots({ everyMs: H, days: [6] }, w)).toEqual({ slots: 24, latest: T0 + 71 * H, capped: false });
  expect(dueSlots({ at: "09:00", days: [6] }, w)).toEqual({ slots: 1, latest: T0 + 57 * H, capped: false });
});
test("at: one slot per local date at the clock time, none before it, two dates over two days", () => {
  const spec = { at: "09:00" };
  expect(dueSlots(spec, { afterMs: T0, uptoMs: T0 + 8 * H, anchorMs: T0 }).slots).toBe(0);
  expect(dueSlots(spec, { afterMs: T0, uptoMs: T0 + 2 * 24 * H, anchorMs: T0 })).toEqual({
    slots: 2,
    latest: T0 + 33 * H,
    capped: false,
  });
});
test("a window longer than 8 days is cut and says capped", () => {
  expect(dueSlots({ everyMs: 24 * H }, { afterMs: T0, uptoMs: T0 + 10 * 24 * H, anchorMs: T0 })).toEqual({
    slots: 8,
    latest: T0 + 10 * 24 * H,
    capped: true,
  });
});
test("nextSlot for every skips unlisted days and returns undefined for no days, and for at is today when the time is ahead and tomorrow when it has passed", () => {
  expect(nextSlot({ everyMs: H, days: [6] }, { afterMs: T0, anchorMs: T0 })).toBe(T0 + 48 * H);
  expect(nextSlot({ everyMs: H, days: [] }, { afterMs: T0, anchorMs: T0 })).toBeUndefined();
  expect(nextSlot({ at: "09:00" }, { afterMs: T0, anchorMs: T0 })).toBe(T0 + 9 * H);
  expect(nextSlot({ at: "09:00" }, { afterMs: T0 + 10 * H, anchorMs: T0 })).toBe(T0 + 33 * H);
  expect(nextSlot({ everyMs: 30 * 24 * H }, { afterMs: T0, anchorMs: T0 })).toBe(T0 + 30 * 24 * H);
});
test("slotKey is per slot for every and per date for at, and localDay pads month and day", () => {
  expect(slotKey({ everyMs: H }, T0 + H)).toBe(`every:${T0 + H}`);
  expect(slotKey({ at: "09:00" }, T0 + 9 * H)).toBe("at:2026-11-12");
  expect(localDay(new Date("2026-01-02T00:00:00Z"))).toBe("2026-01-02");
});
test("scheduleOf maps names to weekdays and an unreadable duration to NaN", () => {
  expect(scheduleOf({ every: "1h", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] })).toEqual({
    everyMs: H,
    days: [1, 2, 3, 4, 5, 6, 0],
  });
  expect(scheduleOf({ every: "bad" }).everyMs).toBeNaN();
});
