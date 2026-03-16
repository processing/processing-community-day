import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isValidPlusCode, resolvePlusCode, olc } from './plus-code.mjs';

// Paris reference: 145 rue La Fayette
// Full code: 8FW4V9H4+MC, short: V9H4+MC, center ~48.879188, 2.356063
const PARIS_FULL = '8FW4V9H4+MC';
const PARIS_LAT = 48.879188;
const PARIS_LON = 2.356063;

function makeNominatimFetch(lat, lon) {
  return async () => ({
    json: async () => [{ lat: String(lat), lon: String(lon) }],
  });
}

function makeEmptyNominatimFetch() {
  return async () => ({ json: async () => [] });
}

function makeThrowingFetch() {
  return async () => { throw new Error('network error'); };
}

// ── isValidPlusCode ──────────────────────────────────────────────────────────

describe('isValidPlusCode', () => {
  test('valid full code', () => assert.equal(isValidPlusCode('8FW4V9H4+MC'), true));
  test('valid 3-char suffix', () => assert.equal(isValidPlusCode('8FW4V9H4+MC7'), true));
  test('trailing spaces normalized', () => assert.equal(isValidPlusCode('8FW4V9H4+MC  '), true));
  test('lowercase normalized', () => assert.equal(isValidPlusCode('8fw4v9h4+mc'), true));
  test('short code → false', () => assert.equal(isValidPlusCode('V9H4+MC'), false));
  test('not a code → false', () => assert.equal(isValidPlusCode('NOTACODE'), false));
  test('empty string → false', () => assert.equal(isValidPlusCode(''), false));
});

// ── resolvePlusCode — fast path ──────────────────────────────────────────────

describe('resolvePlusCode — fast path', () => {
  test('already valid full code', async () => {
    const r = await resolvePlusCode('8FW4V9H4+MC', '', '');
    assert.deepEqual(r, { code: '8FW4V9H4+MC', note: null });
  });

  test('valid code with trailing spaces', async () => {
    const r = await resolvePlusCode('8FW4V9H4+MC  ', '', '');
    assert.deepEqual(r, { code: '8FW4V9H4+MC', note: null });
  });

  test('lowercase valid code', async () => {
    const r = await resolvePlusCode('8fw4v9h4+mc', '', '');
    assert.deepEqual(r, { code: '8FW4V9H4+MC', note: null });
  });
});

// ── resolvePlusCode — short code recovery ────────────────────────────────────

describe('resolvePlusCode — short code recovery', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = makeNominatimFetch(PARIS_LAT, PARIS_LON);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function assertRecovered(result) {
    assert.equal(result.code, PARIS_FULL);
    assert.notEqual(result.note, null);
    if (olc) {
      const decoded = olc.decode(result.code);
      assert.ok(Math.abs(decoded.latitudeCenter - PARIS_LAT) < 0.001, `lat ${decoded.latitudeCenter} not near ${PARIS_LAT}`);
      assert.ok(Math.abs(decoded.longitudeCenter - PARIS_LON) < 0.001, `lon ${decoded.longitudeCenter} not near ${PARIS_LON}`);
    }
  }

  test('short code + city/country fields', async () => {
    assertRecovered(await resolvePlusCode('V9H4+MC', 'Paris', 'France'));
  });

  test('comma-separated city hint', async () => {
    assertRecovered(await resolvePlusCode('V9H4+MC,PARIS', '', ''));
  });

  test('comma-separated city and country hint', async () => {
    assertRecovered(await resolvePlusCode('V9H4+MC,PARIS,FRANCE', '', ''));
  });

  test('hint with spaces around commas (stripped)', async () => {
    assertRecovered(await resolvePlusCode('V9H4+MC, Paris, France', '', ''));
  });

  test('arbitrary prefix text with comma separator', async () => {
    assertRecovered(await resolvePlusCode('My code: V9H4+MC,PARIS', '', ''));
  });

  test('space-separated city hint', async () => {
    assertRecovered(await resolvePlusCode('V9H4+MC PARIS', '', ''));
  });

  test('space-separated city and country hint', async () => {
    assertRecovered(await resolvePlusCode('V9H4+MC PARIS FRANCE', '', ''));
  });

  test('short code with no location ref → null', async () => {
    const r = await resolvePlusCode('V9H4+MC', '', '');
    assert.deepEqual(r, { code: null, note: null });
  });
});

// ── resolvePlusCode — ambiguous input (city chars bleed into code) ───────────
//
// When city chars are valid OLC chars (e.g. P in PARIS), the extraction regex
// absorbs them into the suffix. The result is an incorrect-but-valid-looking
// code — this is a documented limitation. Tests assert the actual behavior so
// future changes don't silently regress it.

describe('resolvePlusCode — ambiguous input (city chars bleed into suffix)', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = makeNominatimFetch(PARIS_LAT, PARIS_LON);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // V9H4+MCPARIS: regex extracts V9H4+MCP (stops at 'A'), but 'ARIS' immediately
  // follows the match — the code is embedded in a longer token, so we reject it.
  test('no separator — null (code embedded in city name)', async () => {
    const r = await resolvePlusCode('V9H4+MCPARIS', '', '');
    assert.equal(r.code, null, 'should reject code embedded in city name');
  });

  test('no separator before city, comma before country — null (code embedded in city name)', async () => {
    // V9H4+MCPARIS,FRANCE → regex extracts V9H4+MCP, but 'ARIS' follows immediately.
    const r = await resolvePlusCode('V9H4+MCPARIS,FRANCE', '', '');
    assert.equal(r.code, null, 'should reject code embedded in city name even with country hint');
  });
});

// ── resolvePlusCode — other failure cases ────────────────────────────────────

describe('resolvePlusCode — failure cases', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('not extractable input', async () => {
    globalThis.fetch = makeNominatimFetch(PARIS_LAT, PARIS_LON);
    const r = await resolvePlusCode('NOTACODE', 'Paris', 'France');
    assert.deepEqual(r, { code: null, note: null });
  });

  test('Nominatim returns empty array', async () => {
    globalThis.fetch = makeEmptyNominatimFetch();
    const r = await resolvePlusCode('V9H4+MC', 'Paris', 'France');
    assert.deepEqual(r, { code: null, note: null });
  });

  test('fetch throws', async () => {
    globalThis.fetch = makeThrowingFetch();
    const r = await resolvePlusCode('V9H4+MC', 'Paris', 'France');
    assert.deepEqual(r, { code: null, note: null });
  });

  test('empty input', async () => {
    globalThis.fetch = makeNominatimFetch(PARIS_LAT, PARIS_LON);
    const r = await resolvePlusCode('', '', '');
    assert.deepEqual(r, { code: null, note: null });
  });
});
