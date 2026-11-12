import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { CHROME_PREFIX } from "./browser.ts";
import { postLine } from "./browser-post.ts";
import { type Channel, MAX_REQUEST_BYTES, startChannel } from "./channel.ts";
import { type ControlDir, createControlDir } from "./control.ts";

const roots: string[] = [];
const channels: Channel[] = [];
function setup(
  post?: Parameters<typeof startChannel>[0]["post"],
  onPost?: Parameters<typeof startChannel>[0]["onPost"],
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  const dir = createControlDir({ root: join(root, "control"), id: "cc-1", rounds: 3 });
  const channel = startChannel({
    dir,
    decide: (call) => ({
      allow: !(typeof call === "object" && call !== null && "deny" in call),
      tool: "Read",
      reason: "No.",
    }),
    ...(post ? { post } : {}),
    ...(onPost ? { onPost } : {}),
    pollMs: 5,
  });
  channels.push(channel);
  return { dir, channel };
}
function request(dir: ControlDir, name: string, value: unknown) {
  const tmp = join(dir.req, `.${name}`);
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, join(dir.req, `${name}.json`));
  vi.advanceTimersByTime(5);
}
function pre(id: string, tool = `${CHROME_PREFIX}navigate`) {
  return { hook_event_name: "PreToolUse", tool_use_id: id, tool_name: tool };
}
function post(id: unknown) {
  return { hook_event_name: "PostToolUse", tool_use_id: id };
}
const a = "aaaaaaaaaaaaaaaa",
  b = "bbbbbbbbbbbbbbbb",
  c = "cccccccccccccccc",
  d = "dddddddddddddddd";
const answer = { text: "safe", line: postLine("safe") };
afterEach(() => {
  for (const channel of channels.splice(0)) channel.stop();
  vi.useRealTimers();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fake() {
  vi.useFakeTimers();
}

test("a post request for an allowed id gets one answer line, which is what post returned, and the text is recorded in posted", () => {
  fake();
  const onPost = vi.fn();
  const { dir, channel } = setup(() => answer, onPost);
  request(dir, a, pre("t"));
  request(dir, b, post("t"));
  expect(readFileSync(join(dir.res, b), "utf8")).toBe(`${answer.line}\n`);
  expect(channel.posted.get("t")).toBe("safe");
  expect(onPost).toHaveBeenCalledWith({ toolUseId: "t", text: "safe" });
});
test("a post request for an id that was never allowed, one for an id already answered, and one with no post option get no answer and the file is removed", () => {
  fake();
  const { dir } = setup(() => answer);
  request(dir, a, post("missing"));
  request(dir, b, pre("t"));
  request(dir, c, post("t"));
  request(dir, d, post("t"));
  for (const name of [a, d]) {
    expect(existsSync(join(dir.res, name))).toBe(false);
    expect(existsSync(join(dir.req, `${name}.json`))).toBe(false);
  }
  const other = setup();
  request(other.dir, a, pre("t"));
  request(other.dir, b, post("t"));
  expect(existsSync(join(other.dir.res, b))).toBe(false);
  expect(existsSync(join(other.dir.req, `${b}.json`))).toBe(false);
});
test("a post file over 2 MiB gets no answer, and a pre request of the same size up to 8 MiB is still decided as before", () => {
  fake();
  const { dir, channel } = setup(() => answer);
  request(dir, a, pre("t"));
  const padding = "x".repeat(2 * 1024 * 1024);
  request(dir, b, { ...post("t"), padding });
  request(dir, c, { ...pre("u"), padding });
  expect(existsSync(join(dir.res, b))).toBe(false);
  expect(existsSync(join(dir.req, `${b}.json`))).toBe(false);
  expect(readFileSync(join(dir.res, c), "utf8")).toBe("allow\n");
  expect(channel.allowedIds.has("u")).toBe(true);
});
test("a post that returns undefined or throws writes no answer and does not stop the channel", () => {
  fake();
  const { dir } = setup((call) => {
    if (typeof call === "object" && call !== null && "throw" in call) throw Error();
    return undefined;
  });
  request(dir, a, pre("t"));
  request(dir, b, post("t"));
  request(dir, c, { ...post("t"), throw: true });
  request(dir, d, pre("u"));
  expect(existsSync(join(dir.res, b))).toBe(false);
  expect(existsSync(join(dir.res, c))).toBe(false);
  expect(readFileSync(join(dir.res, d), "utf8")).toBe("allow\n");
});
test("a post request does not change the allowed or denied counts, and the PreToolUse of the same id still counts once", () => {
  fake();
  const { dir, channel } = setup(() => answer);
  request(dir, a, pre("t"));
  request(dir, b, post("t"));
  expect(channel.counts()).toEqual({ allowed: 1, denied: 0 });
});
test("a repeated post file name is answered again with the same line", () => {
  fake();
  const callback = vi.fn(() => answer);
  const { dir } = setup(callback);
  request(dir, a, pre("t"));
  request(dir, b, post("t"));
  rmSync(join(dir.res, b));
  request(dir, b, post("t"));
  expect(readFileSync(join(dir.res, b), "utf8")).toBe(`${answer.line}\n`);
  expect(callback).toHaveBeenCalledTimes(1);
});
test("chromeIds holds exactly the allowed ids of Chrome tools; a denied Chrome call and an allowed file tool are not in it", () => {
  fake();
  const { dir, channel } = setup();
  request(dir, a, pre("yes"));
  request(dir, b, { ...pre("no"), deny: true });
  request(dir, c, pre("file", "Read"));
  expect([...channel.chromeIds]).toEqual(["yes"]);
});
test("the PreToolUse behaviour is unchanged: a repeated tool use id is denied, a file over 8 MiB is denied", () => {
  fake();
  const { dir, channel } = setup();
  request(dir, a, pre("t"));
  request(dir, b, pre("t"));
  request(dir, c, "x".repeat(MAX_REQUEST_BYTES));
  expect(readFileSync(join(dir.res, b), "utf8")).toContain("already seen");
  expect(readFileSync(join(dir.res, c), "utf8")).toContain("too large");
  expect(channel.counts()).toEqual({ allowed: 1, denied: 2 });
});
