// @ts-check
// Schema.org JSON-LD serialization, generated at build time from loadNodes() output.
// Kept free of Astro imports so node --test can exercise it directly.
import { markdownToText } from './markdown-text.mjs';

/** @typedef {import('./nodes').Node} Node */

const SCHEMA = 'https://schema.org';

/**
 * Serialize JSON-LD for a `<script type="application/ld+json">` tag.
 * Astro's set:html does not escape, and descriptions come from GitHub issues,
 * so escape every `<` to keep `</script>` from closing the tag early.
 * @param {unknown} data
 */
export function jsonLdScript(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** @param {string} siteUrl */
export const seriesId = (siteUrl) => `${siteUrl}/#series`;

/** @param {string} siteUrl */
const organizationId = (siteUrl) => `${siteUrl}/#organization`;

/**
 * Drop undefined, null, '' and empty arrays, plus objects left with only a type.
 * @param {any} value
 * @returns {any}
 */
function compact(value) {
  if (Array.isArray(value)) {
    const items = value.map(compact).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, compact(item)])
      .filter(([, item]) => item !== undefined);
    if (!entries.length || (entries.length === 1 && entries[0][0] === '@type')) return undefined;
    return Object.fromEntries(entries);
  }
  return value === null || value === '' ? undefined : value;
}

/** @param {string | undefined} text */
function plainName(text) {
  return text ? markdownToText(text).trim() : undefined;
}

/**
 * Parse a wall-clock time. One-digit hours occur in event metadata.
 * @param {string | undefined} value
 * @returns {{ minutes: number, formatted: string } | null}
 */
function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return {
    minutes: hours * 60 + minutes,
    formatted: `${String(hours).padStart(2, '0')}:${match[2]}`,
  };
}

/**
 * Event metadata has no timezone, so times carry no offset and Google reads them
 * as local to the venue. Online events have no venue, so they use dates only.
 * Multi-day events with times are daily hours, not one continuous span, so they
 * also use dates only.
 * @param {Node} node
 */
function eventDates(node) {
  const date = node.event_date;
  if (!date) return {};
  const singleDay = !node.event_end_date || node.event_end_date === date;
  const start = parseTime(node.event_start_time);
  if (!node.online_event && singleDay && start !== null) {
    const end = parseTime(node.event_end_time);
    return {
      startDate: `${date}T${start.formatted}`,
      // An end at or before the start is inconsistent; omit it rather than invent an overnight date.
      endDate: end !== null && end.minutes > start.minutes ? `${date}T${end.formatted}` : undefined,
    };
  }
  return { startDate: date, endDate: singleDay ? undefined : node.event_end_date };
}

/**
 * @param {Node} node
 * @param {string} url
 */
function eventLocation(node, url) {
  if (node.online_event) return { '@type': 'VirtualLocation', url: node.event_url ?? url };
  return {
    '@type': 'Place',
    name: node.location_name ?? node.city ?? node.event_name,
    address: {
      '@type': 'PostalAddress',
      streetAddress: node.address,
      addressLocality: node.city,
      addressCountry: node.country,
    },
    // A location-TBD plus code only places the map pin; don't present it as the venue.
    geo: node.location_tbd ? undefined : { '@type': 'GeoCoordinates', latitude: node.lat, longitude: node.lng },
  };
}

/** @param {Node} node */
function eventOrganizer(node) {
  if (node.organization_name) {
    return { '@type': 'Organization', name: plainName(node.organization_name), url: node.organization_url };
  }
  // Names may contain Markdown links; some lack a scheme, so no Person.url.
  return node.organizers.map((organizer) => ({ '@type': 'Person', name: plainName(organizer.name) }));
}

/**
 * Schema.org Event for a canonical event page. Never reads primary_contact.
 * @param {Node} node
 * @param {{ url: string, description: string, imageUrl: string, seriesId: string }} context
 */
export function eventJsonLd(node, { url, description, imageUrl, seriesId }) {
  return compact({
    '@context': SCHEMA,
    '@type': 'Event',
    '@id': `${url}#event`,
    name: node.event_name,
    url,
    description,
    image: [imageUrl],
    // Withdrawn events are deleted, so there is no cancelled state to map yet.
    eventStatus: `${SCHEMA}/EventScheduled`,
    eventAttendanceMode: `${SCHEMA}/${node.online_event ? 'Online' : 'Offline'}EventAttendanceMode`,
    ...eventDates(node),
    location: eventLocation(node, url),
    organizer: eventOrganizer(node),
    superEvent: { '@id': seriesId },
  });
}

/**
 * Homepage graph: the foundation, the site, and the PCD event series.
 * @param {{ siteUrl: string, siteName: string, orgName: string, orgUrl: string }} context
 */
export function siteJsonLd({ siteUrl, siteName, orgName, orgUrl }) {
  const organization = { '@id': organizationId(siteUrl) };
  return {
    '@context': SCHEMA,
    '@graph': [
      { '@type': 'Organization', ...organization, name: orgName, url: orgUrl },
      { '@type': 'WebSite', '@id': `${siteUrl}/#website`, name: siteName, url: `${siteUrl}/`, publisher: organization },
      { '@type': 'EventSeries', '@id': seriesId(siteUrl), name: siteName, url: `${siteUrl}/`, organizer: organization },
    ],
  };
}

/**
 * ItemList of event pages for /events/. Callers pass only non-placeholder events.
 * @param {{ name: string, url: string }[]} items
 */
export function eventListJsonLd(items) {
  return {
    '@context': SCHEMA,
    '@type': 'ItemList',
    itemListElement: items.map(({ name, url }, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url,
      name,
    })),
  };
}
