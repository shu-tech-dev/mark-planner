import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFrontmatter, updateFrontmatter, createFrontmatterFile } from '../src/frontmatter';

test('parses frontmatter and keeps dates as strings', () => {
  const { data, bodyStart } = splitFrontmatter('---\ntitle: a\nstart: 2026-10-06\n---\nbody\n');
  assert.deepEqual(data, { title: 'a', start: '2026-10-06' });
  assert.equal('---\ntitle: a\nstart: 2026-10-06\n---\nbody\n'.slice(bodyStart), 'body\n');
});

test('no frontmatter', () => {
  assert.equal(splitFrontmatter('# hello\n').data, undefined);
  assert.equal(splitFrontmatter('---\nunclosed: true\n').data, undefined);
});

test('empty frontmatter is an empty mapping', () => {
  assert.deepEqual(splitFrontmatter('---\n---\n').data, {});
});

test('update preserves comments, order and body', () => {
  const src = '---\nid: abc123 # keep\ntitle: x\nstart: 2026-10-06\n---\n\n本文\n';
  const out = updateFrontmatter(src, { start: '2026-10-07', end: '2026-10-09' });
  assert.equal(out, '---\nid: abc123 # keep\ntitle: x\nstart: 2026-10-07\nend: 2026-10-09\n---\n\n本文\n');
});

test('update keeps CRLF line endings', () => {
  const out = updateFrontmatter('---\r\ntitle: x\r\n---\r\nbody\r\n', { start: '2026-10-06' });
  assert.equal(out, '---\r\ntitle: x\r\nstart: 2026-10-06\r\n---\r\nbody\r\n');
});

test('update adds frontmatter when missing', () => {
  assert.equal(updateFrontmatter('body\n', { id: 'a1' }), '---\nid: a1\n---\nbody\n');
});

test('create quotes titles that need it', () => {
  const text = createFrontmatterFile({ id: 'a1', title: 'a: b', tags: [] });
  assert.equal(text, '---\nid: a1\ntitle: "a: b"\ntags: []\n---\n');
  assert.deepEqual(splitFrontmatter(text).data, { id: 'a1', title: 'a: b', tags: [] });
});
