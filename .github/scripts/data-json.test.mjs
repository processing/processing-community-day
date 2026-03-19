import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dataJsonPath = resolve(import.meta.dirname, '../../pcd-website/dist/data.json');

let parsed;
try {
  const raw = readFileSync(dataJsonPath, 'utf8');
  parsed = JSON.parse(raw);
} catch (err) {
  throw new Error(
    `Failed to read or parse pcd-website/dist/data.json: ${err.message}\n` +
    `Run "npm run build" from pcd-website/ before running this test.`
  );
}

describe('data.json structure', () => {
  test('top-level keys present', () => {
    assert.ok('schema_version' in parsed, 'missing schema_version');
    assert.ok('generated_at' in parsed, 'missing generated_at');
    assert.ok('event_count' in parsed, 'missing event_count');
    assert.ok('events' in parsed, 'missing events');
  });

  test('event_count matches events.length', () => {
    assert.equal(parsed.event_count, parsed.events.length);
  });
});

describe('data.json events', () => {
  test('no event contains primary_contact', () => {
    for (const event of parsed.events) {
      assert.ok(!('primary_contact' in event), `event ${event.id} contains primary_contact`);
    }
  });

  test('no event contains placeholder', () => {
    for (const event of parsed.events) {
      assert.ok(!('placeholder' in event), `event ${event.id} contains placeholder`);
    }
  });

  test('every canonical_url matches expected pattern', () => {
    for (const event of parsed.events) {
      const expected = `https://day.processing.org/event/${event.id}-${event.uid}/`;
      assert.equal(
        event.canonical_url,
        expected,
        `event ${event.id}: canonical_url mismatch`
      );
    }
  });

  test('every event has finite lat and lng', () => {
    for (const event of parsed.events) {
      assert.ok(Number.isFinite(event.lat), `event ${event.id}: lat is not finite`);
      assert.ok(Number.isFinite(event.lng), `event ${event.id}: lng is not finite`);
    }
  });
});
