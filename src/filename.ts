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

/** `2026-10-06-定例MTG` (without extension). */
export function baseFileName(date: string, title: string): string {
  return `${date.slice(0, 10)}-${sanitizeTitle(title)}`;
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
