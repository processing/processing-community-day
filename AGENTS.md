# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

When making changes to the codebase, please also update this file as needed to reflect any new patterns, tools, or workflows that agents should be aware of. Especially when refactors or architectural changes are made, please update the "Architecture" and "Tech Stack" sections to reflect the new structure and technologies used in the project.

## Project Overview

Static website for Processing Community Day (PCD) 2026 — a global map of events. Built with Astro 5 (static output) + Vue 3 + Leaflet. No database or application backend. Event content is static; the event-list sidebar loads the public Discourse feed at runtime through a fixed proxy.

The Astro project root is `pcd-website/`. All build commands run from there.

## Build Commands

All from the `pcd-website/` directory:

```sh
npm install
npm run dev      # localhost:4321
npm run build    # production build → dist/
npm run preview  # preview production build
```

There are currently no lint scripts configured.

## Tests

See [TEST.md](TEST.md) for the full test inventory and coverage notes.

### Running tests

```sh
node --test .github/scripts/event-issue-helpers.test.mjs
node --test .github/scripts/process-new-event-issue.test.mjs
node --test .github/scripts/process-edit-event-issue.test.mjs
node --test .github/scripts/plus-code.test.mjs
node --test .github/scripts/zines.test.mjs
node --test .github/scripts/zine-build.test.mjs
node --test .github/scripts/process-new-zine-issue.test.mjs

# Requires npm run build from pcd-website/ first:
node --test .github/scripts/data-json.test.mjs
```

Need to run the tests end-to-end? `./scripts/run-tests.sh` executes the helper, event and zine intake, plus-code, and zine metadata suites; runs the zine fixture build; builds the Astro site via `npm --prefix pcd-website run build`; and then runs `data-json.test.mjs` in sequence. Run this script from the repo root after installing dependencies so you get the full battery of checks in one shot.

No install needed — `open-location-code` is already available at `pcd-website/node_modules/`.

### Testing protocol

- Tests live alongside the code they test in `.github/scripts/`.
- Use `node:test` + `node:assert` (built into Node — no test framework needed).
- Build-test assertions for shared icons should allow extra SVG attributes, attribute reordering, and either self-closing or paired path tags; scope checks to the relevant control.
- Mock `globalThis.fetch` with `beforeEach`/`afterEach` for any test that triggers a Nominatim call; always restore the original after each test.
- When adding new functions to `.github/scripts/`, extract pure/testable logic into a separate `*.mjs` module (as was done for `plus-code.mjs`) so it can be imported without triggering the main script's top-level side effects.

## Architecture

### Astro + Vue split

- Organizer Kit pages use a wider shell at 80rem and above to shift the article left and place “On this page” in a 16rem right column. The single TOC stays sticky below the header with bounded scrolling; below that breakpoint it remains inline above the content. Pages without a TOC retain the article width cap.

- **Astro** owns routing, layouts, metadata, and static content pages. `src/layouts/BaseLayout.astro` provides the document shell; `MapLayout.astro`, `SiteLayout.astro`, and `DocsLayout.astro` provide the map, standard content, and Organizer Kit shells respectively.
- The Organizer Kit introduction lives in `src/content/organizer-kit/getting-started/introduction.md`; `/organize/` redirects to its canonical `/organize/getting-started/introduction/` route.
- **Vue** handles the interactive map UI as `client:only="vue"` island components. Map-specific interactive features belong in Vue; static site and Organizer Kit pages belong in Astro and Markdown content collections. The map filter drawer in `MapView.vue` filters clustered markers by date visibility (Future, Past, and Other/no date), format, and activity type; checkbox choices are ORed within a group and filter groups are ANDed together. Date categories are independent eye-icon toggle buttons with `aria-pressed`; all three may be hidden. All three start visible, “Show all” restores only date visibility, and clearing filters restores all categories and clears other criteria. Undated events belong to Other, while ongoing events remain Future through their final local calendar day. Whenever the last category is hidden, `EyelidBlink.vue` mounts a standalone CSS animation teleported over the full viewport: concave radial-gradient masks curve the top lid down at the sides and the bottom lid up at the sides; eyelids close for 420 ms, hold for 1500 ms, and reopen for 480 ms. The last hidden category is restored as reopening begins. The restored eye is already dilated as the screen reopens. After the full-screen blink completes, it holds dilation for 180 ms, then plays a 700 ms blink and squint while its pupil shrinks from 1.35× to normal size and its inward-thickened stroke recedes from a filled disk to the normal ring; this follow-up runs only in the visible filter drawer and is disabled for reduced motion. The animation blocks covered-screen interactions, allows Escape to finish early, finishes when the tab is hidden, cleans up timers/listeners, and uses an opacity fade for reduced motion. No canvas or p5.js dependency is used.

The map filter drawer slides in and out from the left using the shared panel transition, with reduced-motion support. The filter drawer and event detail panel are mutually exclusive: opening either closes the other, with focus moving into the newly opened panel. Opening the filter drawer also closes any open Leaflet popup. While open, it hides the filter and language controls. On desktop, its close tab mirrors the event detail tab on the right edge with a left-pointing chevron, and the count sits beside the title as “x of y shown”. At 640px and below, the drawer fills the width, hides the close tab, and provides a right-pointing “Back to map” button; the compact “n of m” count sits left of Clear filters in the footer. Zero results replace the desktop/mobile count with a localized, bold purple “No matching events” live status. On mobile, “Filter events” replaces “When” in the date legend beside Show all, without a separate title row. The event detail panel’s mobile back button matches this purple, semibold, 44px-minimum-height style with a left-pointing arrow. The filter footer and mobile back button stay outside the flexing options scroller, with safe-area footer padding. Map-page root overscroll is suppressed, while the options scroller contains scroll chaining and retains local rubberbanding. Date controls offer Show all and individual visibility toggles.

### Event list

`/events/` is an Astro page with build-time event cards and a bundled browser script for search, confirmation filters, and accessible Upcoming/Past/Other events tabs. Cmd+K or Ctrl+K focuses the event search and selects its current text; a platform-specific shortcut indicator (⌘K or Ctrl+K) appears inside the input at the right edge and is hidden on mobile. Its English copy follows the static site pages. `src/lib/event-list.mjs` contains shared pure filtering and date-heading logic; `src/styles/event-list.css` owns its presentation. Dates use the visitor's local calendar day and refresh while the page stays open. Multi-day events remain upcoming through their end date and group under Today while ongoing; undated events appear exclusively in the “Other events” tab during normal browsing. A non-empty search keeps the selected tab as its primary result set, including that tab's empty state, then shows matches from other date categories in a labeled section below; confirmation filters still apply to every match. Date headings sit above card groups on a vertical timeline. Cards show shared TBD pills from `base.css`: undated events show “Date to be announced” above the title, or “Date and location to be announced” when both are missing, without a duplicate missing-venue row. Dated events missing a location show “Location to be announced” in the venue row using the date-and-location color; this pill is hidden for past events, including when the visitor’s local date advances while the page is open. Online events have a known location. Cards show date and time above the title; missing times use a light blue (`#81b4d9`) “Time to be announced” pill with white text and are omitted for past events. Upcoming sorts ascending by date; Past sorts descending by date so the most recent events appear first; Other events sorts by event name. The `filter-16` icon opens a labeled native disclosure at the right of the tab bar; search sits below the tabs. Its dropdown applies time, location, and description criteria directly, with no master toggle. Date availability is controlled by the tabs, so it has no filter checkbox. All criteria start unchecked; clearing filters unchecks them. Selecting any criterion excludes placeholders and requires every selected field, and treats a location as a physical address or online event URL. This UI definition does not change `/data.json` eligibility.

`src/components/SkeletonLoader.astro` provides event-card and forum-thread placeholders, with reduced-motion support. Both loaders wait 150 ms before appearing, and completion cancels pending display. Forum placeholders share row, metadata, and avatar styles with real threads to preserve spacing. Event skeletons cover client initialization only; static events remain available without JavaScript and return on window load if initialization fails. Forum skeletons cover each runtime request, including retries, and clear on success, empty responses, and errors.

`src/components/EventListSidebar.astro` renders the submission link (tracked as `Event List Submit Event Button Click` through the shared analytics helper), a 3:2 rectangular CARTO map preview linking to the map, with matching centered crops for the tile and event dots to preserve geographic proportions, and recent PCD forum threads. Forum data is fetched by the browser (never at build time) from `/api/pcd-forum`. `netlify.toml` proxies that exact route to the public Discourse PCD tag JSON feed; `astro.config.mjs` supplies a matching Vite development proxy. Plain `astro preview` does not run this proxy; use `npm run dev` or Netlify to verify the live feed. No API key is required. Keep this a fixed destination, not an open proxy. `src/lib/forum-topics.mjs` validates the response and sorts by `bumped_at` (fallback `last_posted_at`) so pinned topics cannot override activity order. Thread metadata includes up to five overlapping participant avatars, replies (`posts_count - 1`, matching Discourse’s topic list), and relative activity timestamps refreshed every minute with exact dates in tooltips. Avatars resolve from the response’s users and posters, with initials as a fallback. Titles are inserted as text, with loading, empty, error, retry, and direct-forum-link states. The sidebar moves below the list on small screens.

`EventForumThread.vue` renders forum metadata with a slotted hero button when `forum_thread_url` exists. The Forum Thread button matches the info modal host button: transparent background, primary purple text and 1px border, including forum-only events. Hero actions sit directly in the panel without a surrounding box, with a plain localized heading (“Join this PCD” for upcoming events, “More about this PCD” for past events in English), below the date/venue info card and above “About the event”. When both event-page and forum URLs exist, the hero shows equal-width Event Page and Forum Thread buttons (stacked at 640px and below) with metadata below the forum button; forum-only events show the button beside its metadata, wrapping on narrow screens. Map popups show missing times as a compact blue `time-tbd-pill` with localized “Time TBD” text, hidden for past events. Missing times in the detail panel use the shared blue (`#81b4d9`) `time-tbd-pill` with white localized “Time to be announced” text, hidden for past events. The venue/address follows the date row. The hero and About headings share one typography rule. Info-card address links and disclaimer links share colors; OpenStreetMap links and the calendar action use dotted underlines. The localized “About the event” section follows with the description and icon-free activity tags (outside the expandable description), then the rounded minimap. The minimap’s top-right directions button links to OpenStreetMap; keep the button outside the map’s aria-hidden region and above its interaction shield. Contact email appears as a mailto link in the disclaimer using i18n named slots; Foundation events retain a contact sentence without the independence disclaimer. The detail title uses dark grey and its eyebrow stays muted grey. Date and venue icon badges have no colored fill, with purple-300 borders and purple-900 text/icons; the calendar month strip uses purple-700 with white text. The info card uses 40px outlined icon boxes, a localized month/day date badge, stacked primary and secondary date/location text, and 16px row spacing. Known times and the missing-time pill sit to the right of the date and wrap on narrow screens. The purple calendar action sits underneath the date/time line with a left-aligned dropdown; it is hidden for undated events and after the end date (or start date for single-day events), using the visitor’s local calendar day. Past events instead show a shared yellow `.past-event-pill` labeled “Past event” to the right of the date in the event panel and map popup, using the time-TBD pill layout. A link-styled “Hide past events” button sits to the right of the pill in each info card. Both buttons turn off Past visibility while preserving other visible date categories and other filter selections; when Past was the only visible category, they trigger the same blink and restore Past as it reopens. They close the event panel/popup and move focus to the filter button. Visitors can restore past events from the date filter drawer or by clearing filters. Forum metadata includes participant avatars, replies, and relative activity. Its compact 28px-high metadata slot keeps loaded data and skeletons on one row and reserves space immediately (including for retries and failures), while avatar/text skeletons appear after 150 ms using the event-list pulse and reduced-motion behavior. It omits the thread title and loads participants, replies, and activity through `/api/pcd-forum-topic/:id` (fixed Discourse origin; matching Netlify and Vite proxies). `forum-topics.mjs` validates topic URLs and payloads. Requests time out after ten seconds and abort on unmount; failures preserve the visit link and offer retry. Plain Astro preview does not proxy these requests.

### Data loading at build time

Event data lives in `src/content/events/<event-id>/`:
- `metadata.json` — event fields (id, uid, name, location, dates, organizers, etc.)
- `content.md` — markdown body (frontmatter must include `id:` and `uid:`)
  - `uid:` values in frontmatter **must always be quoted** (`uid: "abc1234"`) because unquoted hex strings like `1e46977` are parsed as scientific notation by YAML, destroying the value.

`src/lib/nodes.ts` loads all events at Astro build time using `import.meta.glob()` + `getCollection('events')`, validates plus codes with `OpenLocationCode`, decodes lat/lng, and returns a sorted `Node[]` array passed as props to `<MapView>`.

Zine cards live in `src/content/zines/<slug>/` and the library grid at `/organize/zines/zine-library/` is built dynamically from every `*/index.md`, sorted by its required numeric `order` frontmatter. Every published zine has `index.md`, `metadata.json`, an optional root-level cover image, and a `downloads/` directory. Metadata uses a non-empty generic `downloads` array: local records are `{ file, file_size, role? }` (where `file` is a basename in `downloads/`), and manually maintained external records use `{ url, filename, file_size, role? }`; roles are optionally `reader-order` or `print-ready`. Metadata also requires an event-style `intake` object with `issue_number`, `submitted_by_github`, `submitted_date`, and `maintainer_notes`; the zine detail page links the submitted date to the issue and the username to the submitter's GitHub profile. Root image imports are covers only; opaque downloads import from `*/downloads/` using `?url&no-inline`, while image downloads are emitted from that same directory via Astro's image asset helper. Set optional `created_by_url` in metadata to an http(s) page for the credited creator(s); the detail page links the author name when it is present. Optional `tags` and `languages` are arrays of non-empty strings. Optional `activity_type` describes how the guide is used, while `zine_format` describes publication structure; do not combine them under a generic `format` field. Cover metadata uses `{ "src": "cover.png", "alt": "..." }`. Zines must use `index.md` (not `content.md`) so Astro's glob loader makes the entry id equal to the folder slug. A zine without a cover renders a grey title fallback in the library and detail page.

The `Zine Intake` workflow produces final content directly in `src/content/zines/<slug>/`. Submitters attach files only through GitHub issue-form fields: exactly one reader-order PDF and one print-ready PDF, optional PNG/JPG/JPEG/WebP cover, and optional PDF/ZIP/image/TXT/MD/CSV/JSON supplements. The limits are ten files total, 25 MB per non-image, 10 MB per image, and 50 MB total. Attachment URLs must be GitHub uploads; both Markdown upload links/images and GitHub-generated HTML `<img>` embeds are accepted. When an embedded image URL has no filename, the workflow derives its extension from the validated file signature. The workflow follows only approved GitHub object-store redirects, validates signatures/UTF-8/JSON content, assigns title-derived cover alt text, and writes original filenames (with lowercase extensions) into `downloads/`. Cover and download filenames are separate namespaces, while download filenames must be case-insensitively unique. It builds the Astro site before force-updating the automation-owned `automation/new-zine-<issue-number>` review branch. An invalid later edit preserves the last valid PR commit, marks the PR `needs changes`, and a subsequent valid edit restores `needs review`; maintainer notes are retained in the PR body. Review PDFs for selectable text, logical reading order, document title and language, tagged headings where possible, alt text, and at least one screen-reader-friendly reading-order version.

The global Markdown pipeline runs `rehype-table-wrapper` and `rehype-heading-anchors`, which respectively wrap rendered tables in `.table-wrapper` and add permalink anchors to h2–h6. Their presentation styles live in the shared `prose.css` layer, scoped to both `.prose` and `.docs-prose`, because both plugins apply to all Markdown collections. For a styled caption immediately after a Markdown image, use `<span class="prose-figure-caption">…</span>` on the next line; it supports normal Markdown links for attribution.

**If a plus_code is invalid or too short, the build fails with a clear error — this is intentional.**

**"Confirmed" events in data.json:** An event is included in the `/data.json` feed if it is present in `loadNodes()` and has no `placeholder: true` flag. There are currently no other event states (draft, hidden, etc.). If new states are added in future, the filter in `src/pages/data.json.ts` must be updated explicitly.

### Key implementation details

- **Info modal banner:** Both the homepage and canonical event routes pass a 960px WebP generated from `PCD2026_og-image_tinyfied.png` to `MapView`. The `InfoModal.vue` fallback uses that same current artwork; do not restore the older `community_background_2x.png` fallback.

- **Leaflet CSS** is loaded via `<link>` tags in `MapLayout.astro`, NOT via JS imports — avoids SSR issues since MapView is `client:only="vue"`.
- **Mobile Organizer Kit navigation** lives in the shared header below 641px: “Organize” becomes a native “Organizer Kit” disclosure populated by `getKitNav()`, with nested section disclosures and 48px touch targets. The separate docs navigation is hidden at that breakpoint; tablet and desktop navigation remain in the docs shell. Keep both navigation trees sourced from `getKitNav()`.
- **Docs page share actions** render `ShareMenu.vue` with `client:load` so the control is present in the initial HTML and hydrates immediately. Keep `vue-i18n` in Vite's `ssr.noExternal` list so this server render can resolve its compile-time feature flags.
- **Browser storage** must be accessed through `src/lib/safeStorage.mjs`; direct `localStorage` property access can throw under iOS privacy restrictions and abort Vue island hydration.
- **Transient feedback** uses `Snackbar.vue`. Pass a translated message and close label, and mount each new notification with a unique `key` so its dismiss timeout and circular timer restart. Snackbar close controls and modal close controls share the global `.modal-close-button` style from `base.css`.
- **`open-location-code`** exports `{ OpenLocationCode }` as a named export — use `new OpenLocationCode()` (not static methods).
- **`leaflet.markercluster`** causes a circular dependency warning, suppressed via `rollupOptions.onwarn` in `astro.config.mjs`.
- **Initial map view:** Open at the default world view (center `[20, 10]`, zoom `3`) without requesting the visitor's location. Event deep links still focus their event.
- **Past event markers:** Individual map dots use light grey (`#b0b0b0`) after the event's final day in the visitor's local time, using `isPastEvent()` from `src/lib/format.ts`. Clusters containing only past events use the same grey through `--color-event-past`; mixed clusters retain the confirmed purple. Cluster colors are recomputed from their child markers as filters change. All individual markers are 26px circular dots with a drop shadow. Confirmed events with a date and known physical/online location show a white calendar icon; events with date and/or location TBD (or placeholders) show a white question mark unless they are past events, which remain plain when their details are incomplete. This status icon also applies to online events. Marker symbols import `src/icons/calendar.svg` and `question-mark.svg` as raw SVG; these use the supplied Octicon paths, with the question icon’s outer circle removed. Shadow and active-scale rules target only the marker’s outer SVG so nested symbol SVGs are not scaled or shadowed twice. Upcoming dots use purple (`--color-event-confirmed`, `#5503a4`), and date-only TBD dots use purple (`#7a3eb6`). The shared `--color-event-undated` token also colors the rounded “Date TBD” pill in the map popup and event detail panel. If both date and location are TBD, the marker and combined popup pill use light purple (`--color-event-date-location-tbd`, `#9b6ac7`); the popup pill reads “Date and location TBD”, and the popup omits the duplicate location row. The detail panel instead shows separate “Date to be announced” and “Location to be announced” pills beside their respective icons, using the undated and date-and-location colors respectively. Popup TBD pills sit in the date row below the title/byline with extra vertical spacing. TBD pill text is white for contrast against these colors. Online events retain the date-only undated state because their location is online. Marker colors and active outlines target `.marker-shape`, leaving the white `.marker-symbol` untouched. Future, ongoing, and undated event dots stack above past event dots. Within each group, individual dots stack by the number of known date, location, and start-time fields, with equal counts prioritizing date, then location, then time. From top to bottom: all three; date + location; date + time; location + time; date only; location only; time only; none. Online events count as having a location. This applies to past events and placeholders too. A 32-point non-past bonus exceeds the maximum information score of 31; the combined score sets Leaflet `zIndexOffset` in 1000-point increments so overlapping dots retain this priority independent of insertion order.
- **Deep linking:** `?event=<id-or-uid>` query param auto-opens the event detail panel. Both the slug `id` and the short `uid` are accepted.
- **Event UIDs:** Each event has a stable 7-char hex `uid` stored in both `metadata.json` and `content.md` frontmatter. UIDs never change after creation. Three static URL formats are generated per event: `/event/<slug>` (redirects to canonical), `/event/<slug>-<uid>` (canonical, has OG tags, redirects into SPA), and `/event/<uid>` (short form, redirects to canonical). The canonical URL is what the share button copies.

Every event shows a “Processing Community Day” eyebrow above its title in both `NodePanel.vue` and Leaflet popups (`src/lib/popup.ts`), using the shared `panel.event_eyebrow` translation key. Past-event popups and the event detail panel place a yellow “Past event” pill and the “Hide past events” link beside the date inside the info card, wrapping on narrow screens. They omit physical/online addresses, descriptions, activity tags, and the separator above the details button; venue names and the details button remain available. This compact presentation applies only to map popups, not the event detail panel. Visible popup activity tags fit into at most two rendered rows, including a “+N” overflow indicator. `fitPopupActivities()` measures wrapping on popup open, after fonts load, and when the tag container width changes; it preserves tag order and counts hidden tags. The overflow indicator exposes the full activity list through native `title` hover text and an accessible label, without a custom tooltip or popover. Its resize observer is disconnected when the popup closes or the map unmounts.

### Component roles

| File | Role |
|---|---|
| `src/components/EyelidBlink.vue` | Standalone CSS eyelid animation, reopen/complete events, reduced-motion fade, and lifecycle cleanup |
| `src/components/MapView.vue` | Leaflet map, marker clustering, filter drawer, keyboard shortcuts |
| `src/components/NodePanel.vue` | Slide-in event detail panel with minimap, calendar links, share button |
| `src/components/LanguageSwitcher.vue` | Language selector dropdown in the top bar |
| `src/components/BackButton.astro` | Reusable button-style link for navigating from a detail page back to its parent listing |
| `src/components/DocsPageActions.astro` | Reusable share dropdown (Markdown, permalink, QR code) and GitHub edit action used by Organizer Kit and zine detail pages |
| `src/components/ShareMenu.vue` | Shared Markdown, permalink, and QR-code menu used by docs actions and the event detail panel |
| `src/components/Snackbar.vue` | Reusable auto-dismissing feedback snackbar with an accessible close control and circular countdown |
| `src/directives/touchActivate.ts` | Direct-touch activation for buttons affected by iOS WebKit's unreliable synthesized clicks |
| `src/components/ZineDownloads.astro` | Renders zine download rows with a button, filename, and human-readable file size |
| `src/components/Header.astro` | Shared fixed site header and primary navigation |
| `src/components/Footer.astro` | Shared site footer, policy links, community links, and sponsors |
| `src/layouts/BaseLayout.astro` | Shared HTML document shell and metadata |
| `src/layouts/MapLayout.astro` | Map-page shell and Leaflet stylesheet links |
| `src/layouts/SiteLayout.astro` | Standard static content-page shell |
| `src/layouts/DocsLayout.astro` | Organizer Kit shell with sidebar, page TOC, and footer |
| `src/lib/analytics.ts` | `trackEvent()` Fathom helper + `AnalyticsEvent` type + event-name constants |
| `src/lib/carto.ts` | Adds the optional local-development CARTO API key to basemap tile URLs |
| `src/lib/safeStorage.mjs` | Guards localStorage reads and writes so browser privacy settings cannot abort hydration |
| `src/lib/nodes.ts` | `Node` interface + `loadNodes()` |
| `src/lib/format.ts` | `formatDate()`, `formatDateRange()`, `calendarLinks()`, etc. |
| `src/lib/popup.ts` | Leaflet popup HTML generation (`makePopupContent()`) |
| `src/styles/base.css` | Shared design tokens, reset, typography, focus, and skip-link styles |
| `src/styles/map.css` | Map layout, controls, popup styling, and Leaflet overrides |
| `src/styles/prose.css` | Standard static content-page presentation styles |
| `src/styles/docs/*.css` | Organizer Kit's modular Just-the-Docs-derived tokens, layout, navigation, and Markdown presentation styles |
| `src/lib/rehype-table-wrapper.mjs` | Markdown rehype plugin that wraps rendered tables for horizontal scrolling |
| `src/pages/data.json.ts` | Static JSON feed of confirmed events, served at /data.json |
| `src/pages/activity-guide/[id].astro` | Standalone zine pages |
| `src/lib/zines.ts` | Build-time zine loader and topic-slot mapping |
| `src/lib/zine-metadata.js` | Zine schema and pure metadata/asset validation |
| `src/content.config.ts` | Astro content collection Zod schemas for events, legal pages, Organizer Kit, and zines |
| `src/config.ts` | Global static constants (contact email, etc.) |
| `src/i18n/index.ts` | Creates the `vue-i18n` instance and exports `syncLocale()` |
| `src/i18n/localeState.ts` | Reactive `currentLocale` ref, browser detection, localStorage persistence |
| `src/i18n/vuePlugin.ts` | Astro `appEntrypoint` — installs `vue-i18n` on every Vue island |
| `src/i18n/locales/en.json` | Source-of-truth translation file (all keys must exist here) |
| `src/i18n/locales/*.json` | Per-language translations (es, de, fr, pt, zh-TW, zh-CN, ja, ko) |

## Internationalization (i18n)

The site uses `vue-i18n@11` with 9 supported locales: `en`, `es`, `de`, `fr`, `pt`, `zh-TW`, `zh-CN`, `ja`, `ko`.

### How it's wired up

- `vue-i18n` is installed globally via `astro.config.mjs` → `vue({ appEntrypoint: '/src/i18n/vuePlugin' })`.
- Locale detection order: localStorage (`pcd-locale`) → `navigator.language` → `'en'`.
- The active locale is a reactive singleton (`currentLocale` ref in `localeState.ts`) shared across all components.

### Adding or changing UI strings

1. **Always add the key to `en.json` first.** It is the source of truth and the fallback for all other locales.
2. Add the same key to every other locale file in `src/i18n/locales/`. Missing keys fall back to English silently.
3. In Vue components, use `const { t, locale } = useI18n()` and replace hardcoded text with `t('key')`.
4. In non-component TS files (e.g. `popup.ts`), use `i18n.global.t('key')` imported from `src/i18n/index.ts`.
5. Pass `locale` (or `locale.value` as a string) to `formatDateRange()`, `formatDate()`, etc. for locale-aware date formatting.

### What NOT to translate

Event data coming from content files — `event_name`, `details_text`, `city`, `country`, `organization_name`, organizer names, URLs — must never be wrapped in `t()`. Only static UI strings get translated.

### Non-English word choices

Non-English locales use "Events" (not "Nodes") in list/dialog labels, since "Nodes" is a technical term that doesn't translate naturally.

## Global Configuration (`src/config.ts`)

Use `src/config.ts` for static, non-secret values that are referenced across multiple files or are likely to change. Import from it rather than hardcoding inline.

**Store here:**
- Contact emails (e.g. `PCD_EMAIL`)
- Stable URLs referenced in UI (e.g. a feedback form link)
- Project-wide constants (e.g. site name, org name)

**Do not store here:**
- Environment-specific or secret values — use `.env` with `import.meta.env` for those
- Anything already defined in `astro.config.mjs` (e.g. base path)
- Component-local constants that aren't shared

For local map development, `pcd-website/.env` may define `PUBLIC_CARTO_API_KEY`. During `npm run dev`, all CARTO raster tile URLs append it as the `key` query parameter; production builds do not embed it.

## UI / Styling Rules

- Both map panels open with the shared `--transition-panel-open` (350ms with subtle overshoot), retain `--transition-panel` for closing, and disable transitions for reduced motion. Caret nudges wait another 350ms after the opening transition. Absolutely positioned background pseudo-elements extend 32px beyond each panel's outer viewport edge with a 1px overlap to cover overshoot without changing layout; keep panel overflow visible on mobile too, with content scrolling contained by the inner scroller.

- Map filter and event detail close-tab carets use `--color-primary` (strong purple), including on hover, with a 0.75-unit SVG stroke to thicken the filled chevrons. The shared `close-direction-hint` animation in `map.css` nudges the caret twice after opening (left for filters, right for event details), starting after the panel entrance and respecting reduced motion. The filter tab's mirrored parent reverses the horizontal translation; toggle the hint class with its open state to replay on reopening. Each hint scales up, nudges twice while enlarged, then scales down. Clicking a close tab (including keyboard activation) permanently dismisses that tab’s hint via `safeStorage`, using separate `pcd-filter-close-learned` and `pcd-details-close-learned` keys; other closing methods do not dismiss the hint. Reactive state also suppresses it for the current page when storage is unavailable.

- Organizer Kit `.nav-list` highlights use dedicated tokens in `docs/tokens.css`: light purple for the active page, a paler hover background, and a stronger active-page hover background. Expandable group headings also receive the hover highlight. Nested child links use the same active and hover text colors as top-level links; their muted default color applies only when neither active nor hovered. Active items retain their normal font weight; selection must not make regular-weight links bold.

- The shared purple palette in `base.css` is `#5503a4`, `#7a3eb6`, `#9b6ac7`, `#ba95d8`, and `#d8c2e9` (`--color-purple-900` through `--color-purple-100`). Use semantic tokens for primary actions, links, focus, and event states; lighter palette tokens supply accents and tinted surfaces. Time pills retain their requested blue, past events remain grey, and warning colors retain their semantic meaning.

- Event detail hero actions render directly in the panel without the former surrounding box or title bar; the localized hero heading remains plain text. The detail title uses dark grey while the eyebrow remains muted grey.
- The detail byline sits below the hero actions and above About, as separate localized “Hosted by” then “Organized by” sections with names below each heading. Omit empty sections; retain inline Markdown links and host expansion.

- Do not use diagonal arrows for internal links; use a right-pointing arrow when a directional indicator is needed.

- The site is light-mode only — there is no dark mode, no `[data-theme]` toggling, and no theme-related CSS. Do not reintroduce it without an explicit decision to do so.

## Accessibility

Must follow standard accessibility best practices (semantic HTML, ARIA attributes, keyboard navigation, focus management) for all interactive components (map, panels, buttons, etc.). WCAG 2.1 AA compliance is the goal.

## Event Submission Workflow

### New events

New events are submitted via GitHub Issues using `.github/ISSUE_TEMPLATE/01-new-event.yml`. The workflow `.github/workflows/new-event-intake.yml` (`process-new-event` job) runs `.github/scripts/process-new-event-issue.mjs` to validate the issue and, if valid, opens a PR with generated `metadata.json` + `content.md` files. A stable `uid` is generated at intake and written into both files.

### Edit events

When an edit changes the address but retains the same resolved Plus Code, both the issue confirmation and PR body show a warning linking to the Plus Code so organizers can verify the map location. Comparison trims addresses and normalizes Plus Code case and whitespace. Edit the shared copy in `LOCATION_WARNING_TEMPLATE` in `.github/workflows/new-event-intake.yml`; `{plus_code_url}` and `{issue_reference}` are substituted by the edit script. Direct script runs must supply this environment variable when an address-change warning is needed.

PR confirmation comments use separate initial-submission and event-update messages, selected by the validated edit job output. Both confirmations and PR bodies mention the issue author, remind them to keep their community posted on their forum thread (linked when a URL is available), and link to the Organizer Kit. Only event updates include the canonical event-page update notice; initial submission confirmations explain that the event will be added to the map after merge.

When a valid edit produces no PR because the generated files already match the site, the `create-pr` job upserts the shared status comment with the canonical event link and a short note about the form workaround. This feedback runs only after successful PR creation returns operation `none` without a PR number; failures and existing PRs must not be described as unchanged submissions.

Organizers can edit existing events via `.github/ISSUE_TEMPLATE/04-edit-event.yml`. The same workflow (`process-edit-event` job) runs `.github/scripts/process-edit-event-issue.mjs`. The edit script: reads the existing event by `event_id`, preserves the immutable `uid` and `intake` block, preserves `event_activities` if all checkboxes are unchecked (GitHub issue forms cannot prefill checkboxes), and preserves `content.md` if `full_description` is blank.

### New zines

New zines use `.github/ISSUE_TEMPLATE/05-new-zine.yml` and `.github/workflows/new-zine-intake.yml`. The workflow runs `.github/scripts/process-new-zine-issue.mjs` when an issue labelled `new zine` is opened, edited, reopened, or labelled. It validates and downloads attachments, generates final published files with an event-style `intake` provenance block, builds the site, and force-updates the stable automation-owned `automation/new-zine-<issue-number>` review PR. It upserts one marked status comment; invalid edits leave an existing valid PR unchanged. Zines have no edit issue workflow.

### Shared helpers

Pure functions shared by both intake scripts live in `.github/scripts/event-issue-helpers.mjs`. This includes `parseIssueSections`, validation helpers, `slugify`, `parseActivities`, `parseOrganizers`, `buildValidationComment`, and `generateUniqueUid`.

### Template detection

Intake scripts guard against running on the wrong template:
- `process-new-event-issue.mjs` skips if the body contains `### Event ID` (unique to the edit template)
- `process-edit-event-issue.mjs` skips if the body does NOT contain `### Event ID`
- `process-new-zine-issue.mjs` skips unless the body contains `### Reader-order PDF` (which also matches the former `### Reader-order PDF URL` heading)

## Deployment

Netlify, configured via `netlify.toml`. The site deploys to `https://day.processing.org/` on push to `main`.

The browser-facing CARTO tile key is supplied at build time through
`PUBLIC_CARTO_API_KEY`. Configure it as a Netlify environment variable with
Builds scope; for local development it may be placed in `pcd-website/.env`.
Never commit the key. Without it, the site falls back to unkeyed tile URLs for
local development and may display CARTO's API-key watermark.
