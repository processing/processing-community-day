import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const WEBSITE = resolve(import.meta.dirname, '../../pcd-website');
const DIST = join(WEBSITE, 'dist');
const EVENTS_DIR = join(WEBSITE, 'src/content/events');
const LD_JSON_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

let feed;
try {
  feed = JSON.parse(readFileSync(join(DIST, 'data.json'), 'utf8'));
} catch (err) {
  throw new Error(
    `Failed to read or parse pcd-website/dist/data.json: ${err.message}\n` +
    `Run "npm run build" from pcd-website/ before running this test.`
  );
}

function blocks(pathFromDist) {
  const html = readFileSync(join(DIST, pathFromDist, 'index.html'), 'utf8');
  return [...html.matchAll(LD_JSON_RE)].map((match) => JSON.parse(match[1]));
}

function pagePath(url) {
  return new URL(url).pathname.replace(/^\//, '');
}

function names(value, found = []) {
  if (Array.isArray(value)) value.forEach((item) => names(item, found));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'name' && typeof item === 'string') found.push(item);
      else names(item, found);
    }
  }
  return found;
}

const eventBlocks = feed.events.map((event) => ({ event, found: blocks(pagePath(event.canonical_url)) }));
const homeBlocks = blocks('');
const listBlocks = blocks('events');
const allBlocks = [...eventBlocks.flatMap(({ found }) => found), ...homeBlocks, ...listBlocks];

describe('event page JSON-LD', () => {
  test('every canonical page has exactly one parseable Event block', () => {
    for (const { event, found } of eventBlocks) {
      assert.equal(found.length, 1, `${event.id}: expected one JSON-LD block`);
      assert.equal(found[0]['@type'], 'Event', event.id);
      assert.ok(found[0].name, `${event.id}: missing name`);
      assert.equal(found[0].url, event.canonical_url, event.id);
      assert.ok(found[0].location, `${event.id}: missing location`);
    }
  });

  test('coordinates appear only for confirmed physical locations', () => {
    for (const { event, found: [data] } of eventBlocks) {
      if (event.online_event) {
        assert.equal(data.location['@type'], 'VirtualLocation', event.id);
      } else if (event.location_tbd) {
        assert.equal(data.location['@type'], 'Place', event.id);
        assert.ok(!('geo' in data.location), `${event.id}: location-TBD events must not emit geo`);
      } else {
        assert.equal(data.location['@type'], 'Place', event.id);
        assert.ok(Number.isFinite(data.location.geo?.latitude), `${event.id}: latitude`);
        assert.ok(Number.isFinite(data.location.geo?.longitude), `${event.id}: longitude`);
      }
    }
  });

  test('startDate follows event_date and is absent for dateless events', () => {
    for (const { event, found: [data] } of eventBlocks) {
      if (event.event_date) assert.ok(data.startDate?.startsWith(event.event_date), `${event.id}: startDate ${data.startDate}`);
      else assert.ok(!('startDate' in data), `${event.id}: dateless events must not have startDate`);
    }
  });

  test('redirect variants have no JSON-LD', () => {
    for (const event of feed.events) {
      assert.equal(blocks(`event/${event.id}`).length, 0, `${event.id}: slug redirect`);
      assert.equal(blocks(`event/${event.uid}`).length, 0, `${event.id}: uid redirect`);
    }
  });
});

describe('privacy and plain text', () => {
  const emails = readdirSync(EVENTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => JSON.parse(readFileSync(join(EVENTS_DIR, entry.name, 'metadata.json'), 'utf8')).primary_contact?.email)
    .filter(Boolean);

  test('no primary contact data appears in any block', () => {
    for (const data of allBlocks) {
      const json = JSON.stringify(data);
      assert.ok(!json.includes('primary_contact'));
      for (const email of emails) assert.ok(!json.includes(email), `found contact email ${email}`);
    }
  });

  test('no name contains Markdown link syntax', () => {
    for (const name of allBlocks.flatMap((data) => names(data))) {
      assert.ok(!name.includes(']('), `Markdown in name: ${name}`);
    }
  });
});

describe('site-level JSON-LD', () => {
  test('the homepage graph defines the series every event references', () => {
    assert.equal(homeBlocks.length, 1);
    const graph = homeBlocks[0]['@graph'];
    assert.deepEqual(graph.map((item) => item['@type']).sort(), ['EventSeries', 'Organization', 'WebSite']);
    const series = graph.find((item) => item['@type'] === 'EventSeries');
    for (const { event, found: [data] } of eventBlocks) {
      assert.equal(data.superEvent['@id'], series['@id'], event.id);
    }
  });

  test('the events page lists every event in data.json once', () => {
    assert.equal(listBlocks.length, 1);
    const items = listBlocks[0].itemListElement;
    assert.equal(listBlocks[0]['@type'], 'ItemList');
    assert.equal(items.length, feed.event_count);
    assert.deepEqual(items.map((item) => item.position), items.map((_, index) => index + 1));
    assert.deepEqual(new Set(items.map((item) => item.url)), new Set(feed.events.map((event) => event.canonical_url)));
  });
});
