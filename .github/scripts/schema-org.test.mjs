import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { eventJsonLd, eventListJsonLd, jsonLdScript, seriesId, siteJsonLd } from '../../pcd-website/src/lib/schema.mjs';

const SITE = 'https://day.processing.org';
const URL = `${SITE}/event/pcd-test-2026-abc1234/`;
const context = { url: URL, description: 'A test event.', imageUrl: `${SITE}/og-image.png`, seriesId: seriesId(SITE) };

function node(overrides = {}) {
  return {
    id: 'pcd-test-2026',
    uid: 'abc1234',
    event_name: 'PCD @ Test 2026',
    city: 'Testville',
    country: 'Testland',
    location_name: 'Test Hall',
    address: '1 Test Street',
    location_tbd: false,
    plus_code: '9C3XGV00+00',
    lat: 51.5,
    lng: -0.1,
    online_event: false,
    event_short_description: '',
    details_markdown: '',
    details_html: '',
    details_text: '',
    event_activities: [],
    organizers: [{ name: 'Ada Organizer', name_html: 'Ada Organizer' }],
    primary_contact: { name: 'Private Person', email: 'private@example.com' },
    date_tbd: false,
    time_tbd: false,
    ...overrides,
  };
}

const dates = (overrides) => {
  const { startDate, endDate } = eventJsonLd(node(overrides), context);
  return { startDate, endDate };
};

describe('jsonLdScript', () => {
  test('escapes every < so descriptions cannot close the script tag', () => {
    const out = jsonLdScript({ description: '</script><script>alert(1)</script> a < b' });
    assert.ok(!out.includes('<'));
    assert.deepEqual(JSON.parse(out), { description: '</script><script>alert(1)</script> a < b' });
  });
});

describe('eventJsonLd dates', () => {
  test('dateless events have no startDate or endDate keys', () => {
    const data = eventJsonLd(node({ date_tbd: true }), context);
    assert.ok(!('startDate' in data));
    assert.ok(!('endDate' in data));
  });

  test('date only', () => {
    assert.deepEqual(dates({ event_date: '2026-10-24' }), { startDate: '2026-10-24', endDate: undefined });
  });

  test('single day with times pads one-digit hours', () => {
    assert.deepEqual(
      dates({ event_date: '2026-10-17', event_start_time: '9:00', event_end_time: '12:30' }),
      { startDate: '2026-10-17T09:00', endDate: '2026-10-17T12:30' },
    );
  });

  test('start time without end time', () => {
    assert.deepEqual(dates({ event_date: '2026-10-10', event_start_time: '11:00' }), { startDate: '2026-10-10T11:00', endDate: undefined });
  });

  test('multi-day events with daily hours use dates only', () => {
    assert.deepEqual(
      dates({ event_date: '2026-10-06', event_end_date: '2026-10-07', event_start_time: '11:00', event_end_time: '13:00' }),
      { startDate: '2026-10-06', endDate: '2026-10-07' },
    );
  });

  test('an end date equal to the start date keeps times', () => {
    assert.deepEqual(
      dates({ event_date: '2026-10-17', event_end_date: '2026-10-17', event_start_time: '13:00', event_end_time: '17:00' }),
      { startDate: '2026-10-17T13:00', endDate: '2026-10-17T17:00' },
    );
  });

  test('online events use dates only', () => {
    assert.deepEqual(
      dates({ online_event: true, event_date: '2026-10-17', event_start_time: '9:00', event_end_time: '12:30' }),
      { startDate: '2026-10-17', endDate: undefined },
    );
  });

  test('badly formatted times are treated as absent', () => {
    assert.deepEqual(dates({ event_date: '2026-10-17', event_start_time: '9am', event_end_time: '5pm' }), { startDate: '2026-10-17', endDate: undefined });
  });

  test('out-of-range times are treated as absent', () => {
    for (const time of ['29:99', '24:00', '12:60']) {
      assert.deepEqual(dates({ event_date: '2026-10-17', event_start_time: time }), { startDate: '2026-10-17', endDate: undefined }, time);
      assert.deepEqual(
        dates({ event_date: '2026-10-17', event_start_time: '10:00', event_end_time: time }),
        { startDate: '2026-10-17T10:00', endDate: undefined },
        time,
      );
    }
  });

  test('midnight is a valid start time', () => {
    assert.deepEqual(
      dates({ event_date: '2026-10-17', event_start_time: '00:00', event_end_time: '02:00' }),
      { startDate: '2026-10-17T00:00', endDate: '2026-10-17T02:00' },
    );
  });

  test('an end time at or before the start is omitted, never moved to the next day', () => {
    for (const end of ['10:00', '18:00']) {
      const { startDate, endDate } = dates({ event_date: '2026-10-17', event_start_time: '18:00', event_end_time: end });
      assert.equal(startDate, '2026-10-17T18:00');
      assert.equal(endDate, undefined, end);
    }
    const json = JSON.stringify(eventJsonLd(node({ event_date: '2026-10-17', event_start_time: '18:00', event_end_time: '10:00' }), context));
    assert.ok(!json.includes('2026-10-18'));
  });
});

describe('eventJsonLd organizers', () => {
  test('Markdown link names become plain text', () => {
    const data = eventJsonLd(node({ organizers: [{ name: '[Sabin Timalsena](https://sabin.art/)', name_html: '' }, { name: '[Yu Lee](yu-y.ing)', name_html: '' }] }), context);
    assert.deepEqual(data.organizer, [{ '@type': 'Person', name: 'Sabin Timalsena' }, { '@type': 'Person', name: 'Yu Lee' }]);
  });

  test('several links in one name are all stripped', () => {
    const data = eventJsonLd(node({ organizers: [{ name: '[Gray Area](https://grayarea.org) & [tiat](https://tiat.place)', name_html: '' }] }), context);
    assert.deepEqual(data.organizer, [{ '@type': 'Person', name: 'Gray Area & tiat' }]);
  });

  test('an organization takes precedence over people', () => {
    const data = eventJsonLd(node({ organization_name: 'Test Lab', organization_url: 'https://lab.example' }), context);
    assert.deepEqual(data.organizer, { '@type': 'Organization', name: 'Test Lab', url: 'https://lab.example' });
  });

  test('organizer is omitted when nobody is listed', () => {
    assert.ok(!('organizer' in eventJsonLd(node({ organizers: [] }), context)));
  });

  test('primary contact details never appear', () => {
    const json = JSON.stringify(eventJsonLd(node({ organizers: [] }), context));
    assert.ok(!json.includes('primary_contact'));
    assert.ok(!json.includes('private@example.com'));
    assert.ok(!json.includes('Private Person'));
  });
});

describe('eventJsonLd location', () => {
  test('online events use a VirtualLocation, falling back to the page URL', () => {
    assert.deepEqual(eventJsonLd(node({ online_event: true, event_url: 'https://ccfest.rocks' }), context).location, { '@type': 'VirtualLocation', url: 'https://ccfest.rocks' });
    assert.deepEqual(eventJsonLd(node({ online_event: true }), context).location, { '@type': 'VirtualLocation', url: URL });
    assert.equal(eventJsonLd(node({ online_event: true }), context).eventAttendanceMode, 'https://schema.org/OnlineEventAttendanceMode');
  });

  test('location-TBD events keep city and country but no street or coordinates', () => {
    const { location } = eventJsonLd(node({ address: undefined, location_name: undefined, location_tbd: true }), context);
    assert.deepEqual(location, {
      '@type': 'Place',
      name: 'Testville',
      address: { '@type': 'PostalAddress', addressLocality: 'Testville', addressCountry: 'Testland' },
    });
    assert.ok(!JSON.stringify(location).includes('""'));
  });

  test('confirmed physical addresses include finite coordinates', () => {
    const { location } = eventJsonLd(node(), context);
    assert.equal(location['@type'], 'Place');
    assert.equal(location.address.streetAddress, '1 Test Street');
    assert.ok(Number.isFinite(location.geo.latitude));
    assert.ok(Number.isFinite(location.geo.longitude));
  });
});

describe('series and lists', () => {
  test('superEvent is an @id reference only', () => {
    assert.deepEqual(eventJsonLd(node(), context).superEvent, { '@id': `${SITE}/#series` });
  });

  test('the homepage graph defines the series each event references', () => {
    const graph = siteJsonLd({ siteUrl: SITE, siteName: 'PCD', orgName: 'Foundation', orgUrl: 'https://org.example/' })['@graph'];
    assert.deepEqual(graph.map((item) => item['@type']), ['Organization', 'WebSite', 'EventSeries']);
    assert.equal(graph[2]['@id'], eventJsonLd(node(), context).superEvent['@id']);
  });

  test('ItemList positions run from 1 in order', () => {
    const list = eventListJsonLd([{ name: 'A', url: 'https://a' }, { name: 'B', url: 'https://b' }]);
    assert.deepEqual(list.itemListElement.map((item) => [item.position, item.name]), [[1, 'A'], [2, 'B']]);
  });
});
