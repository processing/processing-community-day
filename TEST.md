# Tests

## Plus Code functions

**File:** `.github/scripts/plus-code.test.mjs`
**Run:** `node --test .github/scripts/plus-code.test.mjs`
**Requires:** `open-location-code` — available locally at `pcd-website/node_modules/open-location-code/` (no install needed). In CI it is installed to `/tmp/script-deps/`.

These tests cover `isValidPlusCode` and `resolvePlusCode` from `.github/scripts/plus-code.mjs`, which are used by the new-event intake script to validate and recover Plus Codes submitted via GitHub Issues.

### `isValidPlusCode`

Pure function — no mocking needed.

| Input | Expected | Reason |
|---|---|---|
| `'8FW4V9H4+MC'` | `true` | Valid full global code |
| `'8FW4V9H4+MC7'` | `true` | Valid 3-char suffix variant |
| `'8FW4V9H4+MC  '` | `true` | Trailing spaces are normalized |
| `'8fw4v9h4+mc'` | `true` | Lowercase is normalized |
| `'V9H4+MC'` | `false` | Short code — not a full global code |
| `'NOTACODE'` | `false` | No Plus Code structure |
| `''` | `false` | Empty string |

### `resolvePlusCode` — fast path

Input is already a valid full code; no Nominatim call is made.

| Input | Expected |
|---|---|
| `('8FW4V9H4+MC', '', '')` | `{ code: '8FW4V9H4+MC', note: null }` |
| `('8FW4V9H4+MC  ', '', '')` | `{ code: '8FW4V9H4+MC', note: null }` — spaces stripped |
| `('8fw4v9h4+mc', '', '')` | `{ code: '8FW4V9H4+MC', note: null }` — uppercased |

### `resolvePlusCode` — short code recovery

Nominatim is mocked to return Paris coordinates (~48.879188, 2.356063). The reference full code is `8FW4V9H4+MC` (short form `V9H4+MC`, near 145 rue La Fayette, Paris).

Recovery tests assert:
1. `result.code === '8FW4V9H4+MC'`
2. `result.note` is non-null
3. The decoded center lat/lon is within 0.001° of the Paris reference

| Input | Expected |
|---|---|
| `('V9H4+MC', 'Paris', 'France')` | Recovers — city/country form fields used as location ref |
| `('V9H4+MC,PARIS', '', '')` | Recovers — comma-separated city extracted from value |
| `('V9H4+MC,PARIS,FRANCE', '', '')` | Recovers — comma-separated city and country extracted |
| `('V9H4+MC, Paris, France', '', '')` | Recovers — spaces around commas stripped before extraction |
| `('My code: V9H4+MC,PARIS', '', '')` | Recovers — arbitrary prefix text is ignored |
| `('V9H4+MC', '', '')` | `{ code: null, note: null }` — short code with no location reference |

### `resolvePlusCode` — ambiguous input

When a city name starts with OLC-valid characters (e.g. `P` in `PARIS`), the extraction regex cannot cleanly separate the short code from the city. This is a documented limitation.

| Input | Behavior |
|---|---|
| `('V9H4+MCPARIS', '', '')` | `V9H4+MCP` is extracted (P absorbed into suffix). No location hint follows, so the result is **not** the correct Paris code. |
| `('V9H4+MCPARIS,FRANCE', '', '')` | `V9H4+MCP` is extracted, `FRANCE` used as hint. Recovery may succeed but produces a code at the wrong location — not `8FW4V9H4+MC`. |

**Supported formats to avoid this:** use a comma separator (`V9H4+MC,Paris`) or provide city/country in the form fields.

### `resolvePlusCode` — failure cases

| Input | Nominatim mock | Expected |
|---|---|---|
| `('NOTACODE', 'Paris', 'France')` | Returns Paris coords | `{ code: null, note: null }` — no extractable code |
| `('V9H4+MC', 'Paris', 'France')` | Returns `[]` | `{ code: null, note: null }` — no geocoding result |
| `('V9H4+MC', 'Paris', 'France')` | Throws | `{ code: null, note: null }` — fetch error caught |
| `('', '', '')` | Returns Paris coords | `{ code: null, note: null }` — empty input |
