import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEditorText, toEditorText } from '../webview/datepicker';

test('parseEditorText accepts YYYY-MM-DD (and slashes, time) and rejects invalid dates', () => {
  assert.equal(parseEditorText('2026-10-05'), '2026-10-05');
  assert.equal(parseEditorText(' 2026/1/5 '), '2026-01-05');
  assert.equal(parseEditorText('2026-10-05 9:30'), '2026-10-05T09:30');
  assert.equal(parseEditorText('2026-10-05T10:00'), '2026-10-05T10:00');
  assert.equal(parseEditorText(''), '');
  assert.equal(parseEditorText('2026-02-30'), undefined);
  assert.equal(parseEditorText('2026-10-05 25:00'), undefined);
  assert.equal(parseEditorText('10/05/2026'), undefined);
  assert.equal(parseEditorText('tomorrow'), undefined);
});

test('toEditorText shows YYYY/MM/DD with a space before the time, and round-trips', () => {
  assert.equal(toEditorText('2026-10-05'), '2026/10/05');
  assert.equal(toEditorText('2026-10-05T10:00'), '2026/10/05 10:00');
  assert.equal(toEditorText(undefined), '');
  for (const v of ['2026-10-05', '2026-01-09T08:05']) {
    assert.equal(parseEditorText(toEditorText(v)), v);
  }
});
