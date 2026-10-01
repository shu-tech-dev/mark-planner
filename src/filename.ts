const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g;
const MAX_TITLE_LENGTH = 60;

/** Makes a title safe for use in a file name on Windows, macOS and Linux. */
export function sanitizeTitle(title: string): string {
  const cleaned = title
    .replace(FORBIDDEN, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  const truncated = Array.from(cleaned).slice(0, MAX_TITLE_LENGTH).join('').trim();
  return truncated || 'untitled';
}

/** `tk2m9a-定例MTG` (without extension). */
export function baseFileName(id: string, title: string): string {
  return `${id}-${sanitizeTitle(title)}`;
}

/**
 * Swaps the ID prefix of a file name (`old-x.md` → `new-x.md`).
 * Returns undefined when the name does not start with `oldId`.
 */
export function replaceIdPrefix(fileName: string, oldId: string, newId: string): string | undefined {
  if (fileName === `${oldId}.md` || fileName.startsWith(`${oldId}-`)) {
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
