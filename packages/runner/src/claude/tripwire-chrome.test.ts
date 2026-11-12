import { expect, test } from "vitest";
import { POST_TEXT } from "./browser-post.ts";
import { createTripwire, type StreamEvent } from "./stream.ts";

const assistant: StreamEvent = {
  type: "assistant",
  message: { content: [{ type: "tool_use", id: "t", name: "Chrome" }] },
};
const result = (content: unknown, is_error = false): StreamEvent => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: "t", content, is_error }] },
});
function wire(posted = new Map<string, string>([["t", "safe"]])) {
  return createTripwire(new Set(["t"]), { ids: new Set(["t"]), posted });
}
test("a Chrome result whose text equals the posted text does not trip, as a string and as one text block", () => {
  for (const content of ["safe", [{ type: "text", text: "safe" }]])
    expect(wire().check(result(content))).toEqual({ tripped: false });
});
test("a Chrome result equal to the fixed replacement sentence does not trip (a slow runner or an oversized request withholds one result)", () => {
  expect(wire(new Map()).check(result(POST_TEXT.unchecked))).toEqual({ tripped: false });
});
test("a Chrome result with no posted entry and another text, a different text, the original three blocks, an empty array or no text trips and names the tool", () => {
  for (const [posted, content] of [
    [new Map(), "other"],
    [new Map([["t", "safe"]]), "other"],
    [
      new Map([["t", "safe"]]),
      [
        { type: "text", text: "safe" },
        { type: "text", text: "extra" },
        { type: "text", text: "extra" },
      ],
    ],
    [new Map([["t", "safe"]]), []],
    [new Map([["t", "safe"]]), undefined],
  ] as const) {
    const w = wire(posted);
    w.check(assistant);
    expect(w.check(result(content))).toEqual({ tripped: true, tool: "Chrome" });
  }
});
test("a Chrome result whose tool_use was never seen in the stream still trips; an error result of a Chrome tool never trips; without the chrome argument the tripwire behaves as before", () => {
  expect(wire().check(result("other"))).toEqual({ tripped: true, tool: "unknown" });
  expect(wire().check(result("other", true))).toEqual({ tripped: false });
  expect(createTripwire(new Set(["t"])).check(result("other"))).toEqual({ tripped: false });
  expect(createTripwire(new Set()).check(result("other"))).toEqual({ tripped: true, tool: "unknown" });
});
