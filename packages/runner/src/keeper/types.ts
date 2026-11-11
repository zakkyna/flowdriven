import type { RateLimit } from "../harness.ts";
export type Waiting = {
  reason: "memory" | "quota" | "ceiling" | "flow_overlap";
  until?: string;
  running?: number;
  ceiling?: number;
  harnessId?: string;
};
export type QuotaWindow = { utilization?: number; resetsAt?: number };
export type HarnessQuota = { rejectedUntil?: number; fiveHour?: QuotaWindow; sevenDay?: QuotaWindow };
export type KeeperConfig = { ceiling: number; reserveMb: number; fiveHourLine: number; sevenDayLine: number };
export type Ticket = {
  runId: string;
  stepId: string;
  itemKey: string;
  kind: "worker" | "judge";
  harnessId: string;
  cls: 0 | 1 | 2;
  underWay: boolean;
  runStartedAt: string;
  weightMb: number;
};
export type Probes = {
  refresh(): Promise<void>;
  availableMb(): number | undefined;
  pressureLevel(): number | undefined;
  groupRssMb(pid: number): number | undefined;
  totalMb(): number;
};
export type Slot = {
  readonly waitedMs: number;
  readonly admittedMs: number;
  attach(pid: number): void;
  release(): { peakMb?: number };
};
export type QueueRowView = {
  ticket: Ticket;
  state: "running" | "waiting";
  waiting?: Waiting;
  queuedMs: number;
};
export type KeeperSnapshot = { ceiling: number; rows: QueueRowView[] };
export interface Keeper {
  acquire(ticket: Ticket, signal: AbortSignal, onWait?: () => void): Promise<Slot>;
  noteLimits(harnessId: string, limits: RateLimit[]): void;
  noteRefused(harnessId: string, untilMs?: number): void;
  noteSuccess(harnessId: string, admittedMs: number): void;
  quotaOf(harnessId: string): HarnessQuota;
  move(runId: string): boolean;
  snapshot(): KeeperSnapshot;
  waitingOf(runId: string): { stepId: string; itemKey: string; waiting: Waiting }[];
  recheck(): void;
  settled(): Promise<void>;
  stop(): void;
}
