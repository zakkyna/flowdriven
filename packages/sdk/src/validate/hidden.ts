const hidden = /[\p{Default_Ignorable_Code_Point}\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export function hasHiddenText(text: string): boolean {
  return hidden.test(text.replaceAll("\n", "").replaceAll("\t", ""));
}
