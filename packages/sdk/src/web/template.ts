export type TemplateCapture = { name: string; set: string; min: number; max: number };
export type UrlTemplate = {
  source: string;
  host: string;
  parts: ({ literal: string } | { capture: TemplateCapture })[];
  captures: TemplateCapture[];
};

export const TEMPLATE_LIMITS = { source: 300, address: 600, captures: 8, repeat: 128 } as const;
export const TEMPLATE_REASON = {
  scheme: "A template starts with https://.",
  host: "The host must be lower-case letters, digits, hyphens and dots, with a dot, and no port, user part or IP address.",
  path: "The path must start with / and use only letters, digits and - . _ ~ /.",
  segment: "A template may not have a . or .. segment, or two slashes in a row.",
  capture: "A capture looks like {name:[class]{m,n}} and may only be in the path.",
  name: "A capture name is a lower-case word and is used once.",
  class: "A class holds single characters and ranges out of A-Z a-z 0-9 _ -.",
  repeat: "A capture repeats at least 1 and at most 128 times, and m is not above n.",
  count: "A template has at most 8 captures.",
  long: "A template is at most 300 characters.",
} as const;

export function isValidHost(host: string): boolean {
  if (host.length > 253 || !/^[a-z0-9.-]+$/.test(host) || !host.includes(".") || host.endsWith(".localhost"))
    return false;
  const labels = host.split(".");
  return (
    labels.every((label) => label.length > 0 && !label.startsWith("-") && !label.endsWith("-")) &&
    /[a-z]/.test(labels.at(-1) ?? "")
  );
}

function validClass(set: string): boolean {
  if (!set) return false;
  let i = 0;
  while (i < set.length) {
    const char = set.charAt(i);
    if (char === "-" && (i === 0 || i === set.length - 1)) {
      i++;
      continue;
    }
    if (!/^[A-Za-z0-9_]$/.test(char)) return false;
    if (set.charAt(i + 1) === "-" && i + 2 < set.length) {
      const end = set.charAt(i + 2);
      const group = (c: string) =>
        /^[a-z]$/.test(c) ? 1 : /^[A-Z]$/.test(c) ? 2 : /^[0-9]$/.test(c) ? 3 : 0;
      if (!group(char) || group(char) !== group(end) || char > end) return false;
      i += 3;
    } else i++;
  }
  return true;
}

export function parseTemplate(
  source: string,
): { ok: true; template: UrlTemplate } | { ok: false; reason: string } {
  const fail = (key: keyof typeof TEMPLATE_REASON) => ({ ok: false as const, reason: TEMPLATE_REASON[key] });
  if (source.length > TEMPLATE_LIMITS.source) return fail("long");
  if (!source.startsWith("https://")) return fail("scheme");
  const slash = source.indexOf("/", 8);
  const host = source.slice(8, slash === -1 ? undefined : slash);
  if (!isValidHost(host)) return fail("host");
  if (slash === -1) return fail("path");
  const path = source.slice(slash);
  const parts: UrlTemplate["parts"] = [];
  const raw: { name: string; set: string; min: string; max: string }[] = [];
  let literal = "";
  let malformed = false;
  let pathInvalid = false;
  let masked = "";
  for (let i = 0; i < path.length; ) {
    const c = path.charAt(i);
    if (c !== "{") {
      if (!/^[A-Za-z0-9._~/-]$/.test(c)) pathInvalid = true;
      literal += c;
      masked += c;
      i++;
      continue;
    }
    if (literal) {
      parts.push({ literal });
      literal = "";
    }
    const match = /^\{([^:{}]*):\[([^\]]*)\]\{(\d+)(?:,(\d+))?\}\}/.exec(path.slice(i));
    if (!match) {
      malformed = true;
      let depth = 0;
      do {
        const char = path.charAt(i++);
        if (char === "{") depth++;
        if (char === "}") depth--;
      } while (depth > 0 && i < path.length);
      masked += "x";
      continue;
    }
    const name = match[1] ?? "";
    const set = match[2] ?? "";
    const min = match[3] ?? "";
    const max = match[4] ?? min;
    raw.push({ name, set, min, max });
    parts.push({ capture: { name, set, min: Number(min), max: Number(max) } });
    masked += "x";
    i += match[0].length;
  }
  if (literal) parts.push({ literal });
  if (pathInvalid) return fail("path");
  if (masked.includes("//") || masked.split("/").some((s) => s === "." || s === "..")) return fail("segment");
  if (malformed) return fail("capture");
  const names = new Set<string>();
  for (const item of raw) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(item.name) || names.has(item.name)) return fail("name");
    names.add(item.name);
  }
  if (raw.some((item) => !validClass(item.set))) return fail("class");
  if (
    raw.some(
      (item) =>
        Number(item.min) < 1 ||
        Number(item.max) > TEMPLATE_LIMITS.repeat ||
        Number(item.min) > Number(item.max),
    )
  )
    return fail("repeat");
  if (raw.length > TEMPLATE_LIMITS.captures) return fail("count");
  const captures = parts.flatMap((part) => ("capture" in part ? [part.capture] : []));
  return { ok: true, template: { source, host, parts, captures } };
}

function inClass(char: string, set: string): boolean {
  for (let i = 0; i < set.length; i++) {
    const start = set.charAt(i);
    if (set.charAt(i + 1) === "-" && i + 2 < set.length && start !== "-") {
      if (char >= start && char <= set.charAt(i + 2)) return true;
      i += 2;
    } else if (char === start) return true;
  }
  return false;
}

export function matchTemplate(template: UrlTemplate, address: string): Record<string, string> | undefined {
  if (address.length > TEMPLATE_LIMITS.address) return undefined;
  try {
    if (new URL(address).href !== address) return undefined;
  } catch {
    return undefined;
  }
  const prefix = `https://${template.host}`;
  if (!address.startsWith(`${prefix}/`)) return undefined;
  const path = address.slice(prefix.length);
  const failed = new Set<string>();
  function match(index: number, position: number): Record<string, string> | undefined {
    const key = `${index}:${position}`;
    if (failed.has(key)) return undefined;
    const part = template.parts.at(index);
    if (!part) return position === path.length ? {} : undefined;
    if ("literal" in part) {
      if (path.startsWith(part.literal, position)) {
        const result = match(index + 1, position + part.literal.length);
        if (result) return result;
      }
    } else {
      const { capture } = part;
      let length = 0;
      while (
        length < capture.max &&
        position + length < path.length &&
        inClass(path.charAt(position + length), capture.set)
      )
        length++;
      for (; length >= capture.min; length--) {
        const result = match(index + 1, position + length);
        if (result) return { [capture.name]: path.slice(position, position + length), ...result };
      }
    }
    failed.add(key);
    return undefined;
  }
  return match(0, 0);
}

export function describeTemplate(template: UrlTemplate): string {
  return `https://${template.host}${template.parts.map((part) => ("literal" in part ? part.literal : `{${part.capture.name}}`)).join("")}`;
}
export function webRates(req: { rate?: { per_run?: number; per_day?: number } }): {
  perRun: number;
  perDay: number;
} {
  return { perRun: req.rate?.per_run ?? 3, perDay: req.rate?.per_day ?? 10 };
}
