import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIssueSections,
  isValidDate,
  isValidTime,
  isValidEmail,
  isValidHttpUrl,
  normalizeUrl,
  slugify,
  parseActivities,
  parseOrganizers,
  generateUniqueUid,
  escapeTableCell,
  eventDataToDisplayMap,
  buildNewEventTable,
  buildEditEventTable,
  formatLongDescription,
  buildPlusCodeNoteBlocks,
  buildPrBody,
} from './event-issue-helpers.mjs';

// ── parseIssueSections ────────────────────────────────────────────────────────

describe('parseIssueSections', () => {
  test('parses normal sections', () => {
    const body = '### Event name\nPCD @ Berlin\n\n### City or locality\nBerlin\n';
    const fields = parseIssueSections(body);
    assert.equal(fields.get('Event name'), 'PCD @ Berlin');
    assert.equal(fields.get('City or locality'), 'Berlin');
  });

  test('cleans _No response_ values', () => {
    const body = '### City or locality\n_No response_\n';
    const fields = parseIssueSections(body);
    assert.equal(fields.get('City or locality'), '');
  });

  test('returns empty map for empty body', () => {
    const fields = parseIssueSections('');
    assert.equal(fields.size, 0);
  });

  test('normalizes \\r\\n line endings', () => {
    const body = '### Event name\r\nPCD @ Test\r\n';
    const fields = parseIssueSections(body);
    assert.equal(fields.get('Event name'), 'PCD @ Test');
  });
});

// ── isValidDate ───────────────────────────────────────────────────────────────

describe('isValidDate', () => {
  test('valid date', () => assert.equal(isValidDate('2026-10-17'), true));
  test('invalid format - missing leading zero', () => assert.equal(isValidDate('2026-1-17'), false));
  test('invalid format - not ISO', () => assert.equal(isValidDate('17/10/2026'), false));
  test('out-of-range month', () => assert.equal(isValidDate('2026-13-01'), false));
  test('out-of-range day', () => assert.equal(isValidDate('2026-01-32'), false));
  test('empty string', () => assert.equal(isValidDate(''), false));
});

// ── isValidTime ───────────────────────────────────────────────────────────────

describe('isValidTime', () => {
  test('valid time', () => assert.equal(isValidTime('14:30'), true));
  test('midnight', () => assert.equal(isValidTime('00:00'), true));
  test('hour 25 is invalid', () => assert.equal(isValidTime('25:00'), false));
  test('bad format - missing colon', () => assert.equal(isValidTime('1430'), false));
  test('minute 60 is invalid', () => assert.equal(isValidTime('14:60'), false));
});

// ── isValidEmail ──────────────────────────────────────────────────────────────

describe('isValidEmail', () => {
  test('valid email', () => assert.equal(isValidEmail('hello@example.com'), true));
  test('missing @', () => assert.equal(isValidEmail('helloexample.com'), false));
  test('missing TLD', () => assert.equal(isValidEmail('hello@example'), false));
  test('empty string', () => assert.equal(isValidEmail(''), false));
});

// ── isValidHttpUrl ────────────────────────────────────────────────────────────

describe('isValidHttpUrl', () => {
  test('http URL', () => assert.equal(isValidHttpUrl('http://example.com'), true));
  test('https URL', () => assert.equal(isValidHttpUrl('https://example.com/path'), true));
  test('ftp rejected', () => assert.equal(isValidHttpUrl('ftp://example.com'), false));
  test('non-URL string', () => assert.equal(isValidHttpUrl('not a url'), false));
  test('empty string', () => assert.equal(isValidHttpUrl(''), false));
});

// ── normalizeUrl ──────────────────────────────────────────────────────────────

describe('normalizeUrl', () => {
  test('http URL unchanged', () => assert.equal(normalizeUrl('http://example.com'), 'http://example.com'));
  test('https URL unchanged', () => assert.equal(normalizeUrl('https://example.com/path'), 'https://example.com/path'));
  test('www without protocol', () => assert.equal(normalizeUrl('www.example.com'), 'http://www.example.com'));
  test('bare domain', () => assert.equal(normalizeUrl('example.com'), 'http://example.com'));
  test('empty string unchanged', () => assert.equal(normalizeUrl(''), ''));
});

// ── slugify ───────────────────────────────────────────────────────────────────

describe('slugify', () => {
  test('removes accents', () => assert.equal(slugify('São Paulo'), 'sao-paulo'));
  test('lowercases and replaces spaces', () => assert.equal(slugify('PCD @ Berlin'), 'pcd-berlin'));
  test('strips leading and trailing dashes', () => assert.equal(slugify('--hello--'), 'hello'));
  test('collapses multiple dashes', () => assert.equal(slugify('a  b   c'), 'a-b-c'));
  test('removes special chars', () => assert.equal(slugify('hello! world?'), 'hello-world'));
});

// ── parseActivities ───────────────────────────────────────────────────────────

describe('parseActivities', () => {
  test('returns checked activities', () => {
    const raw = '- [x] Show-and-tell\n- [ ] Exhibition\n- [x] Live coding\n';
    assert.deepEqual(parseActivities(raw), ['Show-and-tell', 'Live coding']);
  });

  test('returns empty for all unchecked', () => {
    const raw = '- [ ] Show-and-tell\n- [ ] Exhibition\n';
    assert.deepEqual(parseActivities(raw), []);
  });

  test('ignores unknown activities', () => {
    const raw = '- [x] Unknown activity\n- [x] Live coding\n';
    assert.deepEqual(parseActivities(raw), ['Live coding']);
  });

  test('case-insensitive [X]', () => {
    const raw = '- [X] Show-and-tell\n';
    assert.deepEqual(parseActivities(raw), ['Show-and-tell']);
  });
});

// ── parseOrganizers ───────────────────────────────────────────────────────────

describe('parseOrganizers', () => {
  test('plain names', () => {
    assert.deepEqual(parseOrganizers('Jane Doe\nAlex Smith\n'), [
      { name: 'Jane Doe' },
      { name: 'Alex Smith' },
    ]);
  });

  test('strips email suffix', () => {
    assert.deepEqual(parseOrganizers('Jane Doe <jane@example.com>\n'), [
      { name: 'Jane Doe' },
    ]);
  });

  test('blank lines are ignored', () => {
    assert.deepEqual(parseOrganizers('Jane Doe\n\n\nAlex Smith\n'), [
      { name: 'Jane Doe' },
      { name: 'Alex Smith' },
    ]);
  });

  test('returns empty array for empty input', () => {
    assert.deepEqual(parseOrganizers(''), []);
  });
});

// ── generateUniqueUid ─────────────────────────────────────────────────────────

describe('generateUniqueUid', () => {
  test('generates a 7-char string', () => {
    const uid = generateUniqueUid(new Set());
    assert.equal(uid.length, 7);
  });

  test('generates only hex chars', () => {
    const uid = generateUniqueUid(new Set());
    assert.match(uid, /^[0-9a-f]{7}$/);
  });

  test('does not collide with existing uids', () => {
    const existing = new Set(['abc1234', 'def5678']);
    const uid = generateUniqueUid(existing);
    assert.equal(existing.has(uid), true); // was added
    assert.notEqual(uid, 'abc1234');
    assert.notEqual(uid, 'def5678');
  });

  test('adds generated uid to the set', () => {
    const existing = new Set();
    const uid = generateUniqueUid(existing);
    assert.equal(existing.has(uid), true);
  });

  test('generates multiple unique uids in sequence', () => {
    const existing = new Set();
    const uids = new Set();
    for (let i = 0; i < 20; i++) {
      uids.add(generateUniqueUid(existing));
    }
    assert.equal(uids.size, 20);
  });
});

// ── escapeTableCell ───────────────────────────────────────────────────────────

describe('escapeTableCell', () => {
  test('escapes pipe characters', () => {
    assert.equal(escapeTableCell('a | b'), 'a \\| b');
  });

  test('replaces newlines with spaces', () => {
    assert.equal(escapeTableCell('line1\nline2'), 'line1 line2');
  });

  test('handles null/undefined as empty string', () => {
    assert.equal(escapeTableCell(null), '');
    assert.equal(escapeTableCell(undefined), '');
  });
});

// ── eventDataToDisplayMap ─────────────────────────────────────────────────────

describe('eventDataToDisplayMap', () => {
  const baseRecord = {
    event_name: 'PCD @ Tokyo',
    primary_contact: { name: 'Jane Doe', email: 'jane@example.com' },
    online_event: false,
    event_date: '',
    event_end_date: undefined,
    event_start_time: '',
    event_end_time: '',
    event_location: { address: '123 Main St', plus_code: '8FW4V75V+8Q' },
    city: 'Tokyo',
    country: 'Japan',
    organization_name: '',
    organization_url: '',
    organization_type: '',
    event_url: '',
    event_page_url: '',
    forum_thread_url: '',
    event_short_description: 'A gathering.',
    event_activities: ['Live coding', 'Exhibition'],
    organizers: [{ name: 'Jane Doe' }, { name: 'John Smith' }],
  };

  test('returns Map with correct labels and values', () => {
    const map = eventDataToDisplayMap(baseRecord);
    assert.equal(map.get('Event name'), 'PCD @ Tokyo');
    assert.equal(map.get('Contact'), 'Jane Doe (jane@example.com)');
    assert.equal(map.get('Format'), 'In person');
    assert.equal(map.get('City'), 'Tokyo');
    assert.equal(map.get('Country'), 'Japan');
    assert.equal(map.get('Address'), '123 Main St');
    assert.equal(map.get('Plus Code'), '`8FW4V75V+8Q`');
    assert.equal(map.get('Short description'), 'A gathering.');
    assert.equal(map.get('Organizers'), 'Jane Doe, John Smith');
  });

  test('empty string maps to _No response_', () => {
    const map = eventDataToDisplayMap(baseRecord);
    assert.equal(map.get('Date'), '_No response_');
    assert.equal(map.get('Organization'), '_No response_');
  });

  test('undefined maps to _No response_', () => {
    const map = eventDataToDisplayMap(baseRecord);
    assert.equal(map.get('End date'), '_No response_');
  });

  test('false is NOT treated as blank (Format: Online)', () => {
    const map = eventDataToDisplayMap({ ...baseRecord, online_event: false });
    assert.equal(map.get('Format'), 'In person');
  });

  test('activities are sorted for deterministic output', () => {
    const map = eventDataToDisplayMap({ ...baseRecord, event_activities: ['Exhibition', 'Live coding'] });
    assert.equal(map.get('Activities'), 'Exhibition, Live coding');
  });
});

// ── buildNewEventTable ────────────────────────────────────────────────────────

describe('buildNewEventTable', () => {
  test('produces correct markdown table with Field/Value headers', () => {
    const record = {
      event_name: 'PCD @ Tokyo',
      primary_contact: { name: 'Jane', email: 'jane@example.com' },
      online_event: false,
      event_date: '', event_end_date: undefined, event_start_time: '', event_end_time: '',
      event_location: { address: '', plus_code: '' },
      city: '', country: '', organization_name: '', organization_url: '',
      organization_type: '', event_url: '', event_page_url: '', forum_thread_url: '',
      event_short_description: '', event_activities: [], organizers: [],
    };
    const table = buildNewEventTable(eventDataToDisplayMap(record));
    assert.ok(table.startsWith('| Field | Value |'), 'should start with header row');
    assert.ok(table.includes('|---|---|'), 'should include separator');
    assert.ok(table.includes('| Event name | PCD @ Tokyo |'), 'should include event name row');
  });
});

// ── buildEditEventTable ───────────────────────────────────────────────────────

describe('buildEditEventTable', () => {
  const baseRecord = {
    event_name: 'PCD @ Tokyo',
    primary_contact: { name: 'Jane', email: 'jane@example.com' },
    online_event: false,
    event_date: '2026-03-21', event_end_date: undefined, event_start_time: '', event_end_time: '',
    event_location: { address: '123 Main St', plus_code: '8FW4V75V+8Q' },
    city: 'Tokyo', country: 'Japan', organization_name: '', organization_url: '',
    organization_type: '', event_url: '', event_page_url: '', forum_thread_url: '',
    event_short_description: 'A gathering.', event_activities: ['Live coding'], organizers: [],
  };

  test('only includes rows where values differ', () => {
    const prev = eventDataToDisplayMap({ ...baseRecord, event_date: '2026-01-01' });
    const next = eventDataToDisplayMap({ ...baseRecord, event_date: '2026-03-21' });
    const table = buildEditEventTable(prev, next);
    assert.ok(table.includes('| Field | Previous | New |'), 'should have 3-column header');
    assert.ok(table.includes('| Date |'), 'should include changed Date row');
    assert.ok(!table.includes('| Event name |'), 'should not include unchanged Event name');
  });

  test('returns fallback message when nothing changed', () => {
    const map = eventDataToDisplayMap(baseRecord);
    assert.equal(buildEditEventTable(map, map), '_No metadata changes._');
  });

  test('activities compared deterministically (order-insensitive)', () => {
    const prev = eventDataToDisplayMap({ ...baseRecord, event_activities: ['Exhibition', 'Live coding'] });
    const next = eventDataToDisplayMap({ ...baseRecord, event_activities: ['Live coding', 'Exhibition'] });
    assert.equal(buildEditEventTable(prev, next), '_No metadata changes._');
  });
});

// ── formatLongDescription ─────────────────────────────────────────────────────

describe('formatLongDescription', () => {
  test('prefixes each line with > ', () => {
    assert.equal(formatLongDescription('line1\nline2'), '> line1\n> line2');
  });

  test('single line', () => {
    assert.equal(formatLongDescription('Hello world'), '> Hello world');
  });

  test('blank/falsy returns _No response_', () => {
    assert.equal(formatLongDescription(''), '_No response_');
    assert.equal(formatLongDescription(null), '_No response_');
    assert.equal(formatLongDescription(undefined), '_No response_');
    assert.equal(formatLongDescription('   '), '_No response_');
  });

  test('normalizes \\r\\n to \\n', () => {
    assert.equal(formatLongDescription('line1\r\nline2'), '> line1\n> line2');
  });
});

// ── buildPlusCodeNoteBlocks ──────────────────────────────────────────────────

describe('buildPlusCodeNoteBlocks', () => {
  test('returns note block when plusCodeNote is truthy', () => {
    const blocks = buildPlusCodeNoteBlocks(true, 'V75V+8Q', '8FW4V75V+8Q');
    assert.equal(blocks.length, 1);
    assert.ok(blocks[0].includes('> [!NOTE]'));
    assert.ok(blocks[0].includes('`V75V+8Q`'));
    assert.ok(blocks[0].includes('https://plus.codes/8FW4V75V+8Q'));
  });

  test('returns empty array when plusCodeNote is falsy', () => {
    assert.deepEqual(buildPlusCodeNoteBlocks(false, 'V75V+8Q', '8FW4V75V+8Q'), []);
    assert.deepEqual(buildPlusCodeNoteBlocks(null, 'V75V+8Q', '8FW4V75V+8Q'), []);
  });
});

// ── buildPrBody ───────────────────────────────────────────────────────────────

describe('buildPrBody', () => {
  const base = {
    number: 42,
    eventName: 'PCD @ Tokyo',
    submitterLogin: 'someuser',
    plusCodeForLink: '8FW4V75V+8Q',
    dataTable: '| Field | Value |\n|---|---|\n| Event name | PCD @ Tokyo |',
    longDescriptionSection: null,
    noteBlocks: [],
  };

  test('new event body has correct structure', () => {
    const body = buildPrBody({ mode: 'new', ...base });
    assert.ok(body.includes('Closes #42'));
    assert.ok(body.includes('"New Event" issue form'));
    assert.ok(body.includes('### Review checklist'));
    assert.ok(body.includes('The event data below is accurate'));
    assert.ok(body.includes('https://plus.codes/8FW4V75V+8Q'));
    assert.ok(body.includes('### Event data'));
    assert.ok(body.includes('| Field | Value |'));
    assert.ok(!body.includes('### Long description'), 'should not include long description section when null');
  });

  test('edit event body has correct structure', () => {
    const body = buildPrBody({ mode: 'edit', ...base, dataTable: '| Field | Previous | New |\n|---|---|---|\n| Date | old | new |' });
    assert.ok(body.includes('"Edit Event" issue form'));
    assert.ok(body.includes('The changes below are correct'));
    assert.ok(body.includes('### Changes'));
  });

  test('long description section included when provided', () => {
    const body = buildPrBody({ mode: 'new', ...base, longDescriptionSection: '> Some description.' });
    assert.ok(body.includes('### Long description'));
    assert.ok(body.includes('> Some description.'));
  });

  test('noteBlocks appear before Closes line', () => {
    const body = buildPrBody({
      mode: 'new', ...base,
      noteBlocks: ['> [!NOTE]\n> The Plus Code was auto-recovered.'],
    });
    const noteIdx = body.indexOf('> [!NOTE]');
    const closesIdx = body.indexOf('Closes #42');
    assert.ok(noteIdx < closesIdx, 'note should appear before Closes line');
  });

  test('submitter shown as @login when provided', () => {
    const body = buildPrBody({ mode: 'new', ...base });
    assert.ok(body.includes('Submitted by @someuser'));
  });

  test('submitter shown as "the submitter" when login is empty', () => {
    const body = buildPrBody({ mode: 'new', ...base, submitterLogin: '' });
    assert.ok(body.includes('Submitted by the submitter'));
  });
});
