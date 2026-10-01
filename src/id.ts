import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const LENGTH = 6;

/** Short base36 ID (36^6 ≈ 2.2 billion). Retries on collision with `taken`. */
export function generateId(taken: ReadonlySet<string> = new Set()): string {
  for (;;) {
    const bytes = randomBytes(LENGTH);
    let id = '';
    for (const b of bytes) {
      id += ALPHABET[b % ALPHABET.length];
    }
    if (!taken.has(id)) {
      return id;
    }
  }
}
