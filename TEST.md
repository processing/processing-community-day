# Tests

## Organizer Kit and zine OG images

**File:** `.github/scripts/og-images.test.mjs`
**Run:** `npm --prefix pcd-website run build && node --test .github/scripts/og-images.test.mjs`

Checks every published Organizer Kit and zine page for matching absolute Open Graph/Twitter image URLs, checks that zine descriptions lead with their author, decodes all referenced 1200×630 PNGs, checks that no unreferenced images are emitted, and verifies the Organizer Kit redirect image and deployment-base paths. Cache checks confirm identical input reuses the stored PNG (via a sentinel entry), that title, eyebrow, gallery flag, and cover bytes each produce a new entry, and that an unwritable cache directory never fails rendering. Renderer checks cover offline operation, long accented titles, absent covers, and galleries with fewer than five covers. The zine fixture build also verifies that newly added zines receive an emitted OG image. Included in `scripts/run-tests.sh`. Visually review a plain page, the library columns, and single-cover zines when changing the template.

## Map date visibility and eyelid blink

Browser checks against a fresh production build cover desktop and mobile layouts, independent Future/Past/Other visibility, Show all, Hide all, and clearing filters. Hiding the last category starts the full-viewport CSS eyelids: all categories remain hidden through the closed pause, then only the last hidden category returns as the eyes reopen. Hide all restores the last currently visible category in display order. Check each category as the last hidden one, repeat the animation, verify keyboard focus stays on the trigger, and confirm Escape restores visibility immediately. Format/activity choices must survive the blink. Reduced motion uses an opacity fade without moving eyelids. Leaving the tab finishes the blink, and unmounting clears timers and keyboard/visibility listeners.

## Forum sidebar

**File:** `.github/scripts/forum-topics.test.mjs`
**Run:** `node --test .github/scripts/forum-topics.test.mjs`

Covers recent-activity sorting, feed limits, both Discourse tag formats, malformed responses, fixed-origin topic links, reply totals, avatar resolution, and relative timestamps. Browser checks should cover runtime loading, errors/retry, empty feeds, and square map layout.


## Event list

**File:** `.github/scripts/event-list.test.mjs`
**Run:** `node --test .github/scripts/event-list.test.mjs`

Covers calendar boundaries, Today/Tomorrow headings, ongoing and undated events, combined confirmation criteria, placeholder exclusion, and accent-insensitive multi-word search. Included in `scripts/run-tests.sh`.


## Browser storage safety

**File:** `.github/scripts/safe-storage.test.mjs`
**Run:** `node --test .github/scripts/safe-storage.test.mjs`
**Requires:** Node built-ins only — no install needed.

These tests verify that `safeStorage` passes available `localStorage` reads and writes through while returning safe defaults when browser privacy settings make the `localStorage` property itself throw.

---

## Event issue helpers

**File:** `.github/scripts/event-issue-helpers.test.mjs`
**Run:** `node --test .github/scripts/event-issue-helpers.test.mjs`
**Requires:** Node built-ins only — no install needed.

These tests cover the shared pure functions extracted into `event-issue-helpers.mjs`, which are used by both the new-event and edit-event intake scripts.

| Function | Cases |
|---|---|
| `parseIssueSections` | Normal sections, `_No response_` cleaning, empty body, `\r\n` normalization |
| `isValidDate` | Valid date, missing leading zero, non-ISO format, out-of-range month/day, empty string |
| `isValidTime` | Valid time, midnight, hour 25, missing colon, minute 60 |
| `isValidEmail` | Valid email, missing `@`, missing TLD, empty string |
| `isValidHttpUrl` | `http`/`https` valid, `ftp` rejected, non-URL string, empty string |
| `slugify` | Accent removal, lowercase+space→dash, leading/trailing dash strip, multiple dash collapse, special char removal |
| `parseActivities` | Checked boxes, all unchecked, unknown activity filtered, case-insensitive `[X]` |
| `parseOrganizers` | Plain names, `name <email>` suffix stripped, blank lines ignored, empty input |
| `generateUniqueUid` | Length 7, hex chars only, not in existing set, added to set, multiple unique in sequence |

---

## New event intake script

**File:** `.github/scripts/process-new-event-issue.test.mjs`
**Run:** `node --test .github/scripts/process-new-event-issue.test.mjs`
**Requires:** Node built-ins + `open-location-code` at `pcd-website/node_modules/`. Runs the script as a child process against a real temp filesystem.

| Case | Expected |
|---|---|
| Valid new-event issue body | `valid=true`, writes `metadata.json` with all fields including `uid` (7 hex chars) |
| `Event page URL` field present | Value appears in `metadata.json` as `event_page_url` (regression for the `Event website` field-name bug) |
| Duplicate event directory | `valid=false`, validation comment mentions the generated id |
| Issue body contains `### Event canonical ID` heading | `valid=skip` (guard against running on edit-event template) |
| Edit-event issue body (contains `### Event canonical ID` and `### Plus Code (for map placement)`) | `valid=skip` (regression: edit-event body must not be processed as new event) |
| Issue body missing `### Plus Code (for map placement)` and no `### Event canonical ID` | `valid=skip` (unrecognized template) |

---

## Edit event intake script

**File:** `.github/scripts/process-edit-event-issue.test.mjs`
**Run:** `node --test .github/scripts/process-edit-event-issue.test.mjs`
**Requires:** Node built-ins + `open-location-code` at `pcd-website/node_modules/`. Runs the script as a child process; sets up a real test event directory in the repo's events folder with `beforeEach`/`afterEach` cleanup.

| Case | Expected |
|---|---|
| Valid edit issue, event exists | `valid=true`, `pr_label=edit event`, `action_verb=updated on`, metadata updated, `uid` and `intake` preserved |
| Blank `full_description` | Existing `content.md` unchanged |
| All activities unchecked | Existing `event_activities` preserved (checkbox prefill limitation) |
| Some activities checked | `event_activities` overwritten with checked values |
| Event directory does not exist | `valid=false`, validation comment mentions the missing event id |
| Missing `### Event canonical ID` heading | `valid=skip` (guard against running on new-event template) |

---

## data.json build output

**File:** `.github/scripts/data-json.test.mjs`
**Run:** `node --test .github/scripts/data-json.test.mjs`
**Requires:** `npm run build` must be run from `pcd-website/` first — this test reads `pcd-website/dist/data.json`.

| Case | Expected |
|---|---|
| File exists and is valid JSON | Passes without error |
| Top-level keys | `schema_version`, `generated_at`, `event_count`, `events` all present |
| `event_count` vs `events.length` | Equal |
| No `primary_contact` in any event | Omitted (privacy) |
| No `placeholder` in any event | Omitted (all feed entries are confirmed) |
| `canonical_url` shape | Exactly `https://day.processing.org/event/${id}-${uid}/` |
| `lat` and `lng` | Finite numbers on every event |

---

## Schema.org structured data

**Files:** `.github/scripts/schema-org.test.mjs`, `.github/scripts/schema-org-build.test.mjs`, `.github/scripts/schema-org-fixture-build.test.mjs`
**Run:** `node --test .github/scripts/schema-org.test.mjs`; then `npm --prefix pcd-website run build && node --test .github/scripts/schema-org-build.test.mjs`; `node --test .github/scripts/schema-org-fixture-build.test.mjs` runs its own build.
**Requires:** The unit suite needs no build. The build-output suite reads `pcd-website/dist/`. The fixture suite temporarily adds a placeholder event from `.github/scripts/fixtures/events/`, builds the site, and removes the fixture; run it before the main build so `dist/` does not contain the fixture.

| Suite | Cases |
|---|---|
| `schema-org.test.mjs` | `</script>` escaping; dateless, date-only, timed, multi-day, same-day end date, online, malformed, out-of-range, midnight, and end-before-start times; Markdown-free organizer names; organization precedence; omitted organizers; no primary contact; virtual, location-TBD (no `geo`), and confirmed physical locations; `superEvent` references the homepage `EventSeries`; ItemList positions |
| `schema-org-build.test.mjs` | One parseable `Event` per canonical page with `url` equal to `data.json`'s `canonical_url`; `geo` only for confirmed physical locations; `startDate` follows `event_date` and is absent when dateless; no blocks on redirect pages; no contact emails or Markdown names anywhere; homepage `@graph`; `/events/` ItemList matches the feed |
| `schema-org-fixture-build.test.mjs` | A placeholder event's canonical page has no JSON-LD and its URL is absent from the `/events/` ItemList |

Google eligibility is a separate check from Schema.org validity: dateless and online-only events are expected to be ineligible for event rich results, and location-TBD eligibility is unconfirmed. After deployment, run the Rich Results Test on a dated in-person event URL and on `pcd-tokyo-2026-<uid>`, and confirm the rendered page shows the same details as the JSON-LD.

---

## Zines

**Files:** `.github/scripts/zines.test.mjs`, `.github/scripts/zine-build.test.mjs`, `.github/scripts/process-new-zine-issue.test.mjs`
**Run:** `node --test .github/scripts/zines.test.mjs`, `node --test .github/scripts/zine-build.test.mjs`, and `node --test .github/scripts/process-new-zine-issue.test.mjs`
**Requires:** The metadata suite uses the locally installed Astro dependency. The build suite owns a temporary fixture zine, builds the site, verifies emitted cover/PDF URLs and cleans up its fixture.

| Suite | Cases |
|---|---|
| `zines.test.mjs` | Generic download schema, optional covers/languages, manual external downloads, identity/id uniqueness, and root-cover versus `downloads/` asset validation |
| `zine-build.test.mjs` | Published cards, ordering, emitted cover and mixed-format downloads, including same-named root/download images and downloadable JSON assets |
| `process-new-zine-issue.test.mjs` | Attachment-only URL rules, GitHub HTML image embeds and signature-derived cover filenames, namespace-aware filename normalisation/collisions, size boundaries and limits, redirect allowlisting/hop limits, binary signatures, UTF-8/JSON validation, publication-ready file generation, metadata and maintainer-note preservation, order assignment/reuse, slug conflicts, template skipping, authoritative branch shape, and invalid/successful PR label transitions |

---

## Single-command test run

Run `./scripts/run-tests.sh` from the repo root after installing dependencies (`pcd-website` already has `node_modules/` from `npm install`). The script executes the helper, event and zine intake, plus-code, and zine metadata suites; runs the zine and schema.org placeholder fixture builds; then builds the Astro site (`npm run build` inside `pcd-website/`) before running `data-json.test.mjs`, `og-images.test.mjs`, and `schema-org-build.test.mjs`. Use this single command whenever you want to verify the full test battery end to end.

---

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
