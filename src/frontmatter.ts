import { Document, parseDocument } from 'yaml';

export interface FrontmatterBlock {
  /** Parsed YAML mapping, or undefined when the file has no frontmatter. */
  data: Record<string, unknown> | undefined;
  /** Raw YAML source between the fences. */
  yaml: string;
  /** Offset where the body starts (just after the closing fence line). */
  bodyStart: number;
}

const FENCE = /^---[ \t]*$/;
const CLOSE_FENCE = /^(---|\.\.\.)[ \t]*$/;

export function splitFrontmatter(text: string): FrontmatterBlock {
  const none: FrontmatterBlock = { data: undefined, yaml: '', bodyStart: 0 };
  const firstLineEnd = text.indexOf('\n');
  if (firstLineEnd < 0 || !FENCE.test(text.slice(0, firstLineEnd).replace(/\r$/, ''))) {
    return none;
  }

  let pos = firstLineEnd + 1;
  while (pos <= text.length) {
    const lineEnd = text.indexOf('\n', pos);
    const end = lineEnd < 0 ? text.length : lineEnd;
    const line = text.slice(pos, end).replace(/\r$/, '');
    if (CLOSE_FENCE.test(line)) {
      const yaml = text.slice(firstLineEnd + 1, pos);
      const bodyStart = lineEnd < 0 ? text.length : lineEnd + 1;
      return { data: parseMapping(yaml), yaml, bodyStart };
    }
    if (lineEnd < 0) {
      break;
    }
    pos = lineEnd + 1;
  }
  return none;
}

function parseMapping(yaml: string): Record<string, unknown> | undefined {
  try {
    const value = parseDocument(yaml).toJS();
    if (value === null || value === undefined) {
      return {};
    }
    return typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sets (or deletes, with `undefined`) frontmatter keys while preserving the
 * rest of the YAML (comments, key order) and the body untouched.
 * Creates a frontmatter block when the file has none.
 */
export function updateFrontmatter(text: string, patch: Record<string, unknown>): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const block = splitFrontmatter(text);
  const parsed = block.data ? parseDocument(block.yaml) : undefined;
  const doc = parsed?.contents ? parsed : new Document({});
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      doc.delete(key);
    } else {
      doc.set(key, value);
    }
  }
  const yaml = doc.toString({ lineWidth: 0 }).replace(/\r?\n/g, eol);
  const body = block.data ? text.slice(block.bodyStart) : text;
  return `---${eol}${yaml}---${eol}${body}`;
}

export function createFrontmatterFile(data: Record<string, unknown>, body = ''): string {
  const yaml = new Document(data).toString({ lineWidth: 0 });
  return `---\n${yaml}---\n${body}`;
}
