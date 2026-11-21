import type { Notice } from "@flowdriven/contracts/v1";

export function createFakeNoticeSink(): { notices: Notice[]; send: (notice: Notice) => void } {
  const notices: Notice[] = [];
  return {
    notices,
    send: (notice) => {
      notices.push(notice);
    },
  };
}
