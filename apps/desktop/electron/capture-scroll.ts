const ELEMENT_ID = /^[a-z][a-z0-9-]{0,60}$/;

/** The script that scrolls the element with this id to the top; undefined for any id that is not plain. */
export function scrollScript(id: string): string | undefined {
  if (!ELEMENT_ID.test(id)) return undefined;
  return `document.getElementById("${id}")?.scrollIntoView({ block: "start" });`;
}
