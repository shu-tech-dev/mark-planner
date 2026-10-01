/** IDs count seconds from this epoch, so 6 base36 chars last until ~2088. */
const EPOCH_MS = Date.UTC(2020, 0, 1);
const MIN_LENGTH = 6;

let lastIssued = -1;

/**
 * Short, time-sortable base36 ID derived from the creation time in seconds.
 * Lexical order of IDs (and of file names prefixed with them) is creation order.
 * Bumps by one second when the value was already issued in this process or is `taken`.
 */
export function generateId(taken: ReadonlySet<string> = new Set(), now = Date.now()): string {
  let seconds = Math.max(Math.floor((now - EPOCH_MS) / 1000), lastIssued + 1);
  while (taken.has(encode(seconds))) {
    seconds++;
  }
  lastIssued = seconds;
  return encode(seconds);
}

function encode(seconds: number): string {
  return seconds.toString(36).padStart(MIN_LENGTH, '0');
}
