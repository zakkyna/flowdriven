import type { ReactElement } from "react";

const paths = {
  builder: "M4 5h7v7H4z M13 5h7v4h-7z M13 11h7v8h-7z M4 14h7v5H4z",
  inbox: "M4 5h16l2 10v4H2v-4z M2 15h6l2 2h4l2-2h6",
  runs: "M4 5v14l12-7z M19 5v14",
  readiness: "M5 4h14v16H5z M8 9l2 2 4-4 M8 16h8",
  harnesses: "M8 4v5 M16 4v5 M5 9h14v4a7 7 0 0 1-14 0z M12 20v2",
  settings:
    "M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6l1.4 1.4 M17 17l1.4 1.4 M18.4 5.6L17 7 M7 17l-1.4 1.4 M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8",
  check: "M4 12l5 5L20 6",
  cross: "M5 5l14 14 M19 5L5 19",
  clock: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18 M12 7v5l3 2",
  hand: "M7 12V6a2 2 0 0 1 4 0v4V5a2 2 0 0 1 4 0v5V7a2 2 0 0 1 4 0v7c0 4-3 7-7 7H9l-5-6c-1-2 1-3 3-1z",
  ring: "M12 3a9 9 0 1 0 9 9",
  retry: "M20 8a8 8 0 1 0 1 6 M20 3v5h-5",
  pause: "M8 5v14 M16 5v14",
  dash: "M5 12h14",
  stop: "M7 4h10l3 3v10l-3 3H7l-3-3V7z",
  key: "M8 14a5 5 0 1 1 4-4l8 8-2 2-2-2-2 2-2-2 2-2-2-2",
  "circle-slash": "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18 M5.6 5.6l12.8 12.8",
  alert: "M12 3L2 20h20z M12 9v5 M12 17v.1",
  shield: "M12 3l8 3v5c0 5-3 8-8 10-5-2-8-5-8-10V6z",
  half: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18 M12 3v18 M8 5v14 M5 8v8",
  "arrow-up": "M12 20V4 M6 10l6-6 6 6",
  "arrow-down": "M12 4v16 M6 14l6 6 6-6",
  "arrow-left": "M20 12H4 M10 6l-6 6 6 6",
  plus: "M12 4v16 M4 12h16",
  copy: "M8 8h12v12H8z M16 8V4H4v12h4",
  duplicate: "M8 8h12v12H8z M16 8V4H4v12h4 M14 11v6 M11 14h6",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v5 M14 11v5",
  undo: "M9 7L4 12l5 5 M4 12h10a6 6 0 0 1 6 6",
  send: "M3 4l18 8-18 8 3-8z M6 12h15",
  post: "M4 4h16v16H4z M8 9h8 M8 13h8 M8 17h5",
  coin: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18 M15 8H10a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H9 M12 6v12",
  lock: "M5 10h14v10H5z M8 10V7a4 4 0 0 1 8 0v3 M12 14v2",
} as const;
export type IconName = keyof typeof paths;
export const ICON_NAMES: readonly IconName[] = Object.keys(paths) as IconName[];
export function Icon({ name, size = 18 }: { name: IconName; size?: number }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
