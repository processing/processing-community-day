import { createRequire } from 'node:module';

// OLC library path: CI installs to /tmp/script-deps, locally it's in pcd-website/node_modules
const _require = createRequire(import.meta.url);
export let olc = null;
for (const candidate of [
  '/tmp/script-deps/node_modules/open-location-code/openlocationcode.js',
  new URL('../../pcd-website/node_modules/open-location-code/openlocationcode.js', import.meta.url).pathname,
]) {
  try {
    const { OpenLocationCode } = _require(candidate);
    olc = new OpenLocationCode();
    break;
  } catch { /* try next */ }
}

// OLC character set used in both validation and extraction regexes.
const OLC = '[23456789CFGHJMPQRVWX]';
const VALID_FULL_RE = new RegExp(`^${OLC}{8}\\+${OLC}{2,3}$`);

export function isValidPlusCode(value) {
  return VALID_FULL_RE.test(value.replace(/\s+/g, '').toUpperCase());
}

// Match the full run of OLC chars after '+' as one block, then accept only if
// the run is exactly 2–3 chars long. This prevents V9H4+MCPARIS from being
// misread as V9H4+MCP: the full run "MCP…" is longer than 3, so no match.
const EXTRACT_RE = new RegExp(
  `(${OLC}{2,8}\\+)(${OLC}+)`,
  'i',
);

export async function resolvePlusCode(rawValue, city, country) {
  const normalized = rawValue.replace(/\s+/g, '').toUpperCase();

  if (!normalized) return { code: null, note: null };

  // Fast path: already a valid full global OLC
  if (VALID_FULL_RE.test(normalized)) return { code: normalized, note: null };

  if (!olc) return { code: null, note: null };

  // Use the uppercased-but-space-preserved form for extraction so that a
  // space between the code and city (e.g. "QX5Q+C5 DENVER") is still visible
  // to the word-boundary guard below. Stripping spaces first would turn that
  // into "QX5Q+C5DENVER" and make a valid input look like a bleed-in case.
  const uppercased = rawValue.toUpperCase();

  // Try to extract a Plus Code from anywhere in the input (e.g. "My code: QX5Q+C5,DENVER").
  // No leading anchor so we match even with arbitrary prefix text.
  // Captures the full run of OLC chars after '+'; the suffix length check below
  // rejects cases where city chars bleed into the suffix (see suffix.length > 3).
  const match = uppercased.match(EXTRACT_RE);

  let shortCode = normalized;
  let locationHint = '';

  if (match) {
    const [fullMatch, prefix, suffix] = match;

    // Suffix must be exactly 2–3 OLC chars. A longer run means the city name bled
    // into the code (e.g. "V9H4+MCPARIS" → suffix "MCPARIS", length 7).
    if (suffix.length > 3) {
      console.log(`[plus-code] rejected "${rawValue}": suffix "${suffix}" is longer than 3 chars`);
      return { code: null, note: null };
    }

    // Reject if the matched code is immediately followed by a word character.
    // Non-OLC chars in the city name can truncate the suffix early, e.g. V9H4+MCPARIS
    // matches as V9H4+MCP (stops at 'A') but 'ARIS' follows — the code is embedded
    // in a longer token and must be rejected.
    const afterCode = uppercased.slice(match.index + fullMatch.length);
    if (/^\w/.test(afterCode)) {
      console.log(`[plus-code] rejected "${rawValue}": extracted "${fullMatch}" is followed by word chars "${afterCode}"`);
      return { code: null, note: null };
    }

    shortCode = (prefix + suffix).replace(/\s+/g, '');

    // Extract any trailing non-OLC text as a location hint (e.g. ",DENVER,COLORADO").
    // Used only when the city/country form fields are empty.
    if (afterCode) {
      locationHint = afterCode
        .replace(/,/g, ' ')
        .trim()
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }

  // Attempt recovery if we have a short OLC and a location reference.
  // Prefer explicit city/country fields; fall back to the hint extracted from the input.
  const locationRef = (city || country)
    ? [city, country].filter(Boolean).join(' ')
    : locationHint;

  if (olc.isShort(shortCode) && locationRef) {
    try {
      const query = encodeURIComponent(locationRef);
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`,
        { headers: { 'User-Agent': 'PCD-Event-Intake/1.0' } },
      );
      const results = await response.json();
      if (results.length > 0) {
        const { lat, lon } = results[0];
        const recovered = olc.recoverNearest(shortCode, parseFloat(lat), parseFloat(lon));
        if (VALID_FULL_RE.test(recovered)) {
          return { code: recovered, note: 'auto-recovered from short code + city' };
        }
      }
    } catch (err) {
      console.log(`[plus-code] recovery failed: ${err.message}`);
    }
  }

  return { code: null, note: null };
}
