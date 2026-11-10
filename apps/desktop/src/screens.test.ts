import { expect, test } from "vitest";
import screens from "../electron/screens.json";
import { parseRoute } from "./nav/route";

test("every captured screen is a real route, once", () => {
  expect(screens).toHaveLength(8);
  expect(new Set(screens.map((s) => s.name)).size).toBe(8);
  for (const s of screens) expect(parseRoute(`#${s.hash}`).screen).not.toBe("not_found");
});
