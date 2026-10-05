/**
 * File name for a new ID after a duplicate is fixed. Planner files are `<id>.md`;
 * copies made by file managers (`<id> copy.md`, `<id> - Copy.md`, `<id> (2).md`)
 * become `<newId>.md`, and older `<id>-title.md` names keep their title.
 * Returns undefined when the name does not start with `oldId`.
 */
export function replaceIdPrefix(fileName: string, oldId: string, newId: string): string | undefined {
  if (fileName === `${oldId}.md` || fileName.startsWith(`${oldId} `)) {
    return `${newId}.md`;
  }
  if (fileName.startsWith(`${oldId}-`)) {
    return newId + fileName.slice(oldId.length);
  }
  return undefined;
}

/** Appends `-2`, `-3`, ... until `exists` reports the name as free. */
export async function uniqueFileName(
  base: string,
  exists: (fileName: string) => Promise<boolean>,
  ext = '.md',
): Promise<string> {
  let name = `${base}${ext}`;
  for (let n = 2; await exists(name); n++) {
    name = `${base}-${n}${ext}`;
  }
  return name;
}
