import type { ReactElement } from "react";

const paths = {
  builder:
    "M4.5 2.4a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8zM4.5 10.8a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8zM11.5 4.6a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8zM4.5 5.2v5.6M11.5 7.4c0 2.4-2.2 2.9-5.6 3.4",
  inbox:
    "M2.5 9.5L4.2 4.6a1 1 0 0 1 .95-.68h5.7a1 1 0 0 1 .95.68L13.5 9.5V12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1zM2.5 9.5h3.2l.8 1.6h3l.8-1.6h3.2",
  runs: "M5 3.5v9l7.5-4.5z",
  readiness:
    "M5 3h6a1.5 1.5 0 0 1 1.5 1.5V12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 12V4.5A1.5 1.5 0 0 1 5 3zM6 3V2.2h4V3M6 8.6l1.5 1.5L10.2 7",
  harnesses: "M6 2.5v3M10 2.5v3M4.5 5.5h7v2.2a3.5 3.5 0 0 1-7 0zM8 11.2v2.3",
  settings:
    "M2.5 5h5.5M11.5 5h2M2.5 11h1.5M7 11h6.5M10 3.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3zM5.5 9.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3z",
  check: "M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM5.3 8.2l1.9 1.9 3.5-3.7",
  tick: "M3.5 8.4l3 3 6-6.4",
  cross: "M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM6 6l4 4M10 6l-4 4",
  clock: "M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM8 4.8V8l2.1 1.3",
  hand: "M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM5.3 8h.2M7.9 8h.2M10.5 8h.2",
  ring: "M8 2a6 6 0 1 0 6 6",
  pause: "M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM6.7 6.2v3.6M9.3 6.2v3.6",
  dash: "M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12z",
  alert: "M8 2.5L14 13H2zM8 6.8v2.8M8 11.3h.01",
  send: "M14 2L7.2 8.8M14 2l-4.3 12-2.5-5.2L2 6.3z",
  post: "M4.5 2.5h7A1.5 1.5 0 0 1 13 4v8a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 12V4a1.5 1.5 0 0 1 1.5-1.5zM5.5 6h5M5.5 8.5h5M5.5 11H8",
  undo: "M5.5 3.5L3 6l2.5 2.5M3 6h6.2a3.3 3.3 0 0 1 0 6.6H6.5",
  "arrow-up": "M8 13V3.5M4 7.3l4-3.8 4 3.8",
  "arrow-down": "M8 3v9.5M4 8.7l4 3.8 4-3.8",
  list: "M3 4.5h10M3 8h10M3 11.5h6",
  mark: "M4 6.4a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2zM12 2.4a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2zM12 10.4a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2zM5.5 7.3L10.5 4.7M5.5 8.7l5 2.6",
  plus: "M8 3v10M3 8h10",
  retry: "M13.33 5.33a5.33 5.33 0 1 0 0.67 4M13.33 2v3.33h-3.33",
  stop: "M4.67 2.67h6.67l2 2v6.67l-2 2H4.67l-2-2V4.67z",
  key: "M5.33 9.33a3.33 3.33 0 1 1 2.67-2.67l5.33 5.33-1.33 1.33-1.33-1.33-1.33 1.33-1.33-1.33 1.33-1.33-1.33-1.33",
  "circle-slash": "M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM3.73 3.73l8.53 8.53",
  shield: "M8 2l5.33 2v3.33c0 3.33-2 5.33-5.33 6.67-3.33-1.33-5.33-3.33-5.33-6.67V4z",
  half: "M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM8 2v12M5.33 3.33v9.33M3.33 5.33v5.33",
  "arrow-left": "M13.33 8H2.67M6.67 4l-4 4 4 4",
  copy: "M5.33 5.33h8v8H5.33zM10.67 5.33V2.67H2.67v8h2.67",
  duplicate: "M5.33 5.33h8v8H5.33zM10.67 5.33V2.67H2.67v8h2.67M9.33 7.33v4M7.33 9.33h4",
  trash: "M2.67 4.67h10.67M6 4.67V2.67h4v2M4 4.67l.67 8.67h6.67l.67-8.67M6.67 7.33v3.33M9.33 7.33v3.33",
  coin: "M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM10 5.33H6.67a1.33 1.33 0 0 0 0 2.67h2.67a1.33 1.33 0 0 1 0 2.67H6M8 4v8",
  lock: "M3.33 6.67h9.33v6.67H3.33zM5.33 6.67V4.67a2.67 2.67 0 0 1 5.33 0v2M8 9.33v1.33",
} as const;
export type IconName = keyof typeof paths;
export const ICON_NAMES: readonly IconName[] = Object.keys(paths) as IconName[];
export function Icon({
  name,
  size = 16,
  spin = false,
}: {
  name: IconName;
  size?: number;
  spin?: boolean;
}): ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-spin={spin ? "true" : undefined}
    >
      <path d={paths[name]} strokeDasharray={name === "dash" ? "2.2 2.4" : undefined} />
    </svg>
  );
}
