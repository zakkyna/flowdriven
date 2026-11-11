import { CST, isMap, isScalar, isSeq, Lexer, parseDocument } from "yaml";
import { FlowFileError } from "../hash/canonical.ts";

export function parseFlowYaml(text: string): unknown {
  if (new TextEncoder().encode(text).length > 262144)
    throw new FlowFileError("too_large", "YAML is too large");
  try {
    const doc = parseDocument(text, { schema: "core", uniqueKeys: false, version: "1.2" });
    const problem = doc.errors.at(0) ?? doc.warnings.at(0);
    if (problem) throw problem;
    for (const token of new Lexer().lex(text)) {
      const type = CST.tokenType(token);
      if (type === "tag" || type === "anchor" || type === "alias")
        throw new Error(`YAML ${type} is not allowed`);
    }
    const visit = (node: unknown): void => {
      if (isMap(node)) {
        const keys = new Set<unknown>();
        for (const pair of node.items) {
          if (!isScalar(pair.key)) throw new Error("Complex YAML keys are not allowed");
          const key = String(pair.key.value);
          if (keys.has(key)) throw new Error(`Duplicate YAML key: ${key}`);
          keys.add(key);
          visit(pair.value);
        }
      } else if (isSeq(node)) for (const item of node.items) visit(item);
    };
    visit(doc.contents);
    return doc.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new FlowFileError("yaml", error instanceof Error ? error.message : String(error));
  }
}
