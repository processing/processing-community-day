import type { Node } from './nodes';
import { formatDateRange } from './format';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const POPUP_PREVIEW_LENGTH = 120;

export function makePopupContent(node: Node): string {
  const date = escapeHtml(formatDateRange(node.start_date, node.end_date));
  const rawText = node.short_description.trim() || ((node.long_description ?? '').split(/\n\n+/)[0] ?? '');
  const blurb = rawText.length > POPUP_PREVIEW_LENGTH
    ? escapeHtml(rawText.slice(0, POPUP_PREVIEW_LENGTH).trimEnd()) + '&hellip;'
    : escapeHtml(rawText);
  const descriptionHtml = blurb ? `<p class="popup-description">${blurb}</p>` : '';

  const placeholderBanner = node.placeholder
    ? `<div class="popup-placeholder">&#9888; This is placeholder data. No real event has been confirmed at this location.</div>`
    : !node.confirmed
      ? `<div class="popup-unconfirmed">&#8505; This event has not been confirmed yet.${node.forum_url ? ` <a href="${escapeHtml(node.forum_url)}" target="_blank" rel="noopener noreferrer">Follow the forum thread</a> for updates.` : ''}</div>`
      : '';

  const addressQuery = node.address
    ? `${node.venue}, ${node.address}`
    : `${node.venue}, ${node.city}, ${node.country}`;
  const osmUrl = `https://www.openstreetmap.org/search?query=${encodeURIComponent(addressQuery)}`;
  const venueHtml = `<p class="popup-venue">at <a href="${osmUrl}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(addressQuery)}">${escapeHtml(node.venue)}</a></p>`;

  return `
    <div class="popup-content">
      ${placeholderBanner}
      <h3 class="popup-name">${escapeHtml(node.name)}</h3>
      <p class="popup-date"><strong>${date}</strong></p>
      ${venueHtml}
      <div class="popup-body">
        ${descriptionHtml}
        <button class="read-more" data-node-id="${escapeHtml(node.id)}">Read more &rarr;</button>
      </div>
    </div>
  `.trim();
}
