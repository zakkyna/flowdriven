import { CST, Lexer, parseDocument } from "yaml";
import { FlowFileError } from "../hash/canonical.ts";

export function parseFlowYaml(text: string): unknown {
  try {
    const doc = parseDocument(text, { schema: "core", uniqueKeys: true, version: "1.2" });
    const problem = doc.errors.at(0) ?? doc.warnings.at(0);
    if (problem) throw problem;
    for (const token of new Lexer().lex(text)) {
      const type = CST.tokenType(token);
      if (type === "tag" || type === "anchor" || type === "alias")
        throw new Error(`YAML ${type} is not allowed`);
    }
    return doc.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new FlowFileError("yaml", error instanceof Error ? error.message : String(error));
  }
}
