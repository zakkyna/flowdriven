import { durationMs } from "@flowdriven/sdk";
import { MAX_WINDOW_MS } from "./constants.ts";

export type ScheduleSpec = { everyMs?: number; at?: string; days?: number[] };
type Window = { afterMs: number; uptoMs: number; anchorMs: number };
type Result = { slots: number; latest?: number; capped: boolean };

export function localDay(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function scheduleOf(t: { every?: string; at?: string; days?: string[] }): ScheduleSpec {
  const spec: ScheduleSpec = {};
  if (t.every !== undefined) {
    try {
      spec.everyMs = durationMs(t.every);
    } catch {
      spec.everyMs = NaN;
    }
  }
  if (t.at !== undefined) spec.at = t.at;
  if (t.days !== undefined) {
    const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    spec.days = t.days.map((day) => weekdays.indexOf(day));
  }
  return spec;
}

function valid(spec: ScheduleSpec): boolean {
  if ((spec.everyMs === undefined) === (spec.at === undefined)) return false;
  if (spec.days?.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return false;
  if (spec.everyMs !== undefined) return Number.isFinite(spec.everyMs) && spec.everyMs >= 1;
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(spec.at ?? "");
}

function indices(afterMs: number, uptoMs: number, anchorMs: number, everyMs: number): [number, number] {
  return [
    Math.max(1, Math.floor((afterMs - anchorMs) / everyMs) + 1),
    Math.floor((uptoMs - anchorMs) / everyMs),
  ];
}

export function dueSlots(spec: ScheduleSpec, w: Window): Result {
  if (
    !valid(spec) ||
    ![w.afterMs, w.uptoMs, w.anchorMs].every(Number.isFinite) ||
    w.afterMs >= w.uptoMs ||
    !Number.isFinite(new Date(w.afterMs).getTime()) ||
    !Number.isFinite(new Date(w.uptoMs).getTime())
  )
    return { slots: 0, capped: false };
  const capped = w.uptoMs - w.afterMs > MAX_WINDOW_MS;
  const after = capped ? w.uptoMs - MAX_WINDOW_MS : w.afterMs;
  let slots = 0;
  let latest: number | undefined;
  const addEvery = (start: number, end: number, everyMs: number) => {
    const [first, last] = indices(start, end, w.anchorMs, everyMs);
    if (last >= first) {
      slots += last - first + 1;
      latest = w.anchorMs + last * everyMs;
    }
  };
  if (spec.everyMs !== undefined && spec.days === undefined) {
    addEvery(after, w.uptoMs, spec.everyMs);
  } else {
    const date = new Date(after);
    date.setHours(0, 0, 0, 0);
    while (date.getTime() <= w.uptoMs) {
      const start = date.getTime();
      const tomorrow = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
      if (spec.days === undefined || spec.days.includes(date.getDay())) {
        if (spec.everyMs !== undefined) {
          const [firstAfter, lastUpto] = indices(after, w.uptoMs, w.anchorMs, spec.everyMs);
          const first = Math.max(firstAfter, Math.ceil((start - w.anchorMs) / spec.everyMs));
          const last = Math.min(lastUpto, Math.ceil((tomorrow - w.anchorMs) / spec.everyMs) - 1);
          if (last >= first) {
            slots += last - first + 1;
            latest = w.anchorMs + last * spec.everyMs;
          }
        } else if (spec.at !== undefined) {
          const slot = new Date(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
            Number(spec.at.slice(0, 2)),
            Number(spec.at.slice(3)),
          ).getTime();
          if (slot > after && slot <= w.uptoMs) {
            slots++;
            latest = slot;
          }
        }
      }
      if (!Number.isFinite(tomorrow) || tomorrow <= start) break;
      date.setTime(tomorrow);
    }
  }
  return latest === undefined ? { slots, capped } : { slots, latest, capped };
}

export function nextSlot(spec: ScheduleSpec, w: { afterMs: number; anchorMs: number }): number | undefined {
  if (
    !valid(spec) ||
    !Number.isFinite(w.afterMs) ||
    !Number.isFinite(w.anchorMs) ||
    !Number.isFinite(new Date(w.afterMs).getTime()) ||
    spec.days?.length === 0
  )
    return undefined;
  if (spec.everyMs !== undefined && spec.days === undefined) {
    const [first] = indices(w.afterMs, w.afterMs, w.anchorMs, spec.everyMs);
    const slot = w.anchorMs + first * spec.everyMs;
    return Number.isFinite(slot) && slot > w.afterMs ? slot : undefined;
  }
  const end = w.afterMs + MAX_WINDOW_MS;
  const date = new Date(w.afterMs);
  date.setHours(0, 0, 0, 0);
  while (date.getTime() <= end) {
    const start = date.getTime();
    const tomorrow = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    if (spec.days === undefined || spec.days.includes(date.getDay())) {
      let slot: number;
      if (spec.everyMs !== undefined) {
        const [firstAfter] = indices(w.afterMs, end, w.anchorMs, spec.everyMs);
        const first = Math.max(firstAfter, Math.ceil((start - w.anchorMs) / spec.everyMs));
        slot = w.anchorMs + first * spec.everyMs;
      } else {
        const at = spec.at ?? "";
        slot = new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          Number(at.slice(0, 2)),
          Number(at.slice(3)),
        ).getTime();
      }
      if (slot > w.afterMs && slot <= end && slot < tomorrow) return slot;
    }
    if (!Number.isFinite(tomorrow) || tomorrow <= start) break;
    date.setTime(tomorrow);
  }
  return undefined;
}

export function slotKey(spec: ScheduleSpec, slotMs: number): string {
  return spec.everyMs !== undefined ? `every:${slotMs}` : `at:${localDay(new Date(slotMs))}`;
}
