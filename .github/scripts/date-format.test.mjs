import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateRange, formatPopupDate } from '../../pcd-website/src/lib/format.ts';

test('event info dates include the weekday for single-day events', () => {
  assert.equal(formatDateRange('2026-10-17', undefined, false, 'en', true), 'Saturday, October 17, 2026');
  assert.equal(formatDateRange('2026-10-17', '2026-10-17', false, 'en', true), 'Saturday, October 17, 2026');
});

test('event info ranges show both weekdays within a month and across month and year boundaries', () => {
  for (const [start, end, first, last] of [
    ['2026-10-17', '2026-10-18', 'Saturday, October 17', 'Sunday, October 18, 2026'],
    ['2026-10-31', '2026-11-01', 'Saturday, October 31', 'Sunday, November 1, 2026'],
    ['2026-12-31', '2027-01-01', 'Thursday, December 31, 2026', 'Friday, January 1, 2027'],
  ]) {
    const formatted = formatDateRange(start, end, false, 'en', true);
    assert.ok(formatted.includes(first), formatted);
    assert.ok(formatted.includes(last), formatted);
  }
});

test('weekdays follow the selected locale for single dates and ranges', () => {
  for (const locale of ['en', 'es', 'de', 'fr', 'pt', 'zh-TW', 'zh-CN', 'ja', 'ko']) {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
    const saturday = weekday.format(new Date('2026-10-17T00:00:00Z'));
    const sunday = weekday.format(new Date('2026-10-18T00:00:00Z'));
    assert.ok(formatDateRange('2026-10-17', undefined, false, locale, true).includes(saturday), locale);
    const range = formatDateRange('2026-10-17', '2026-10-18', false, locale, true);
    assert.ok(range.includes(saturday), `${locale}: ${range}`);
    assert.ok(range.includes(sunday), `${locale}: ${range}`);
  }
});

test('compact popup dates keep their existing formatting', () => {
  assert.equal(formatPopupDate('2026-10-17'), 'Sat, Oct 17, 2026');
  assert.equal(formatPopupDate('2026-10-17', '2026-10-18'), 'Oct 17–18, 2026');
  assert.equal(formatPopupDate('2026-10-31', '2026-11-01'), 'Oct 31 – Nov 1, 2026');
  assert.equal(formatPopupDate('2026-12-31', '2027-01-01'), 'Thu, Dec 31, 2026 – Fri, Jan 1, 2027');
});

test('other date consumers retain their existing defaults', () => {
  assert.equal(formatDateRange('2026-10-17'), 'October 17, 2026');
  assert.equal(formatDateRange('2026-10-17', '2026-10-18'), 'October 17–18, 2026');
});
