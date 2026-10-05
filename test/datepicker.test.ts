import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHour, withMinutes } from '../webview/timepicker';
import { addHour, joinDateTime, parseEditorText, parseTime, toEditorText } from '../webview/datepicker';

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

test('joinDateTime combines the date and time fields', () => {
  assert.equal(joinDateTime('2026/10/05', '10:30', false), '2026-10-05T10:30');
  assert.equal(joinDateTime('2026/10/05', '10:30', true), '2026-10-05'); // all day drops the time
  assert.equal(joinDateTime('2026/10/05', '', false), '2026-10-05'); // no time → date only
  assert.equal(joinDateTime('', '10:30', false), ''); // no date → unset
  assert.equal(joinDateTime('2026/02/30', '10:30', false), undefined);
  assert.equal(joinDateTime('2026/10/05', '930', false), '2026-10-05T09:30'); // loose time
  assert.equal(joinDateTime('2026/10/05', '25:00', false), undefined); // invalid time
  assert.equal(joinDateTime('2026/10/05', '25:00', true), '2026-10-05'); // ignored when all day
  // A time typed into the date field is replaced by the time field.
  assert.equal(joinDateTime('2026/10/05 08:00', '09:15', false), '2026-10-05T09:15');
});

test('addHour stays within the day', () => {
  assert.equal(addHour('09:00'), '10:00');
  assert.equal(addHour('09:45'), '10:45');
  assert.equal(addHour('22:30'), '23:30');
  assert.equal(addHour('23:15'), '23:59');
});

test('parseTime accepts loose 24-hour input', () => {
  assert.equal(parseTime('9'), '09:00');
  assert.equal(parseTime('930'), '09:30');
  assert.equal(parseTime('9:30'), '09:30');
  assert.equal(parseTime(' 21:05 '), '21:05');
  assert.equal(parseTime('１０：００'), '10:00'); // full-width (IME)
  assert.equal(parseTime(''), '');
  assert.equal(parseTime('24:00'), undefined);
  assert.equal(parseTime('9:75'), undefined);
  assert.equal(parseTime('9am'), undefined);
});

test('time picker sets the hour and minutes separately', () => {
  assert.equal(withHour('', 9), '09:00');
  assert.equal(withHour('10:45', 14), '14:45');
  assert.equal(withHour('930', 7), '07:30'); // loose input is understood
  assert.equal(withMinutes('', '30'), '09:30');
  assert.equal(withMinutes('14:00', '15'), '14:15');
  assert.equal(withMinutes('bad', '45'), '09:45');
});
