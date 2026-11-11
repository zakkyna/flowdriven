const allowed = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "$schema",
  "$id",
  "title",
  "description",
]);
const types = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
const object = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equal(v, b.at(i)));
  if (object(a) && object(b))
    return (
      Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]))
    );
  return false;
}
export function validateJsonSchema(schema: unknown, value: unknown): string[] {
  const errors: string[] = [];
  function visit(s: unknown, v: unknown, path: string): void {
    if (!object(s)) {
      errors.push(`${path}: invalid schema`);
      return;
    }
    for (const k of Object.keys(s)) if (!allowed.has(k)) errors.push(`unsupported schema keyword ${k}`);
    if (s.type !== undefined) {
      const ts = Array.isArray(s.type) ? s.type : [s.type];
      if (ts.length === 0 || ts.some((t) => typeof t !== "string" || !types.has(t)))
        errors.push(`${path}: invalid type`);
      else if (
        v !== undefined &&
        !ts.some((t) =>
          t === "null"
            ? v === null
            : t === "object"
              ? object(v)
              : t === "array"
                ? Array.isArray(v)
                : t === "integer"
                  ? typeof v === "number" && Number.isInteger(v)
                  : t === "number"
                    ? typeof v === "number" && Number.isFinite(v)
                    : typeof v === t,
        )
      )
        errors.push(`${path}: type mismatch`);
    }
    if (
      v !== undefined &&
      s.enum !== undefined &&
      (!Array.isArray(s.enum) || !s.enum.some((x) => equal(x, v)))
    )
      errors.push(`${path}: enum mismatch`);
    if (v !== undefined && Object.hasOwn(s, "const") && !equal(s.const, v))
      errors.push(`${path}: const mismatch`);
    for (const k of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"] as const) {
      const limit = s[k];
      if (limit === undefined) continue;
      if (
        typeof limit !== "number" ||
        !Number.isFinite(limit) ||
        ((k.includes("Length") || k.includes("Items")) && (!Number.isInteger(limit) || limit < 0))
      ) {
        errors.push(`${path}: invalid ${k}`);
        continue;
      }
      const actual =
        k.includes("Length") && typeof v === "string"
          ? [...v].length
          : k.includes("Items") && Array.isArray(v)
            ? v.length
            : (k === "minimum" || k === "maximum") && typeof v === "number"
              ? v
              : undefined;
      if (actual !== undefined && (k.startsWith("min") ? actual < limit : actual > limit))
        errors.push(`${path}: ${k}`);
    }
    if (
      s.required !== undefined &&
      (!Array.isArray(s.required) || s.required.some((x) => typeof x !== "string"))
    )
      errors.push(`${path}: invalid required`);
    else if (object(v) && Array.isArray(s.required))
      for (const k of s.required) if (!Object.hasOwn(v, k)) errors.push(`${path}: required ${k}`);
    if (s.properties !== undefined && !object(s.properties)) errors.push(`${path}: invalid properties`);
    if (s.additionalProperties !== undefined && typeof s.additionalProperties !== "boolean")
      errors.push(`${path}: invalid additionalProperties`);
    if (object(s.properties))
      for (const [k, sub] of Object.entries(s.properties))
        visit(sub, object(v) && Object.hasOwn(v, k) ? v[k] : undefined, `${path}.${k}`);
    if (object(v) && s.additionalProperties === false)
      for (const k of Object.keys(v))
        if (!object(s.properties) || !Object.hasOwn(s.properties, k))
          errors.push(`${path}: additionalProperties ${k}`);
    if (s.items !== undefined) {
      if (Array.isArray(v) && v.length)
        for (const [i, item] of v.entries()) visit(s.items, item, `${path}[${i}]`);
      else visit(s.items, undefined, `${path}[]`);
    }
  }
  visit(schema, value, "$");
  return errors;
}
