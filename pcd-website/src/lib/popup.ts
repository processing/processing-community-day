import type { Node } from './nodes';
import { formatPopupDate, isPastEvent } from './format';
import { i18n } from '../i18n/index';
import { currentLocale } from '../i18n/localeState';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function t(key: string, params?: Record<string, string>): string {
  return i18n.global.t(key, params ?? {});
}

const POPUP_PREVIEW_LENGTH = 120;

/** Fit complete tags and the overflow count into two rendered rows. */
export function fitPopupActivities(container: HTMLElement): () => void {
  const list = container.querySelector<HTMLElement>('.popup-activities');
  const overflow = list?.querySelector<HTMLElement>('.popup-activity-overflow');
  const count = overflow?.querySelector<HTMLElement>('.popup-activity-count');
  if (!list || !overflow || !count) return () => {};
  const tags = Array.from(list.querySelectorAll<HTMLElement>(':scope > .popup-activity-tag'));
  const rows = () => new Set(
    [...tags, overflow].filter((tag) => !tag.hidden).map((tag) => tag.offsetTop)
  ).size;
  const fit = () => {
    tags.forEach((tag) => { tag.hidden = false; });
    overflow.hidden = true;
    if (rows() <= 2) return;
    overflow.hidden = false;
    for (let hidden = 1; hidden <= tags.length; hidden++) {
      tags[tags.length - hidden].hidden = true;
      count.textContent = `+${hidden}`;
      if (rows() <= 2) break;
    }
  };
  fit();
  let width = list.getBoundingClientRect().width;
  const observer = new ResizeObserver(() => {
    const nextWidth = list.getBoundingClientRect().width;
    if (nextWidth !== width) {
      width = nextWidth;
      fit();
    }
  });
  observer.observe(list);
  let active = true;
  document.fonts.ready.then(() => { if (active) fit(); });
  return () => { active = false; observer.disconnect(); };
}

export function getOsmUrl(node: Node): string {
  const { lat, lng } = node;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}

export function makePopupContent(node: Node): string {
  const locale = currentLocale.value;
  const past = isPastEvent(node);

  const date = node.date_tbd
    ? t('popup.date_tbd')
    : escapeHtml(formatPopupDate(node.event_date ?? '', node.event_end_date, locale));

  const rawText = node.event_short_description.trim();
  const blurb = rawText.length > POPUP_PREVIEW_LENGTH
    ? escapeHtml(rawText.slice(0, POPUP_PREVIEW_LENGTH).trimEnd()) + '&hellip;'
    : escapeHtml(rawText);
  const descriptionHtml = !past && blurb ? `<p class="popup-description">${blurb}</p>` : '';

  const placeholderBanner = node.placeholder
    ? `<div class="popup-placeholder">&#9888; ${escapeHtml(t('popup.placeholder_warning').replace(/^⚠\s*/, ''))}</div>`
    : '';

  const organizingEntityHtml = node.organization_name
    ? `<p class="popup-organizing-entity">${t('panel.by')} ${escapeHtml(node.organization_name)}</p>`
    : '';

  const onlineBadgeHtml = node.online_event ? `<span class="popup-online-badge">${t('popup.online_event')}</span>` : '';
  const timeHint = !node.date_tbd && node.time_tbd && !past ? ` · ${t('popup.time_tbd')}` : '';
  const dateLineContent = `${date}${timeHint}`;

  const venueNameHtml = node.online_event
    ? ''
    : node.location_tbd
      ? `<span class="popup-venue-name popup-venue-tbd">${t('popup.location_tbd')}</span>`
      : node.location_name
        ? `<span class="popup-venue-name">${escapeHtml(node.location_name)}</span>`
        : '';

  const onlineAddressText = node.event_url ? escapeHtml(node.event_url) : t('popup.online_event');

  const venueAddressHtml = node.online_event
    ? node.event_url
      ? `<a
          href="${escapeHtml(node.event_url)}"
          target="_blank"
          rel="noopener noreferrer"
          class="popup-venue-address"
          title="${escapeHtml(t('popup.join_online'))}"
        >${onlineAddressText}</a>`
      : `<span class="popup-venue-address">${onlineAddressText}</span>`
    : node.location_tbd
      ? ''
    : node.address
      ? `<a
          href="${escapeHtml(getOsmUrl(node))}"
          target="_blank"
          rel="noopener noreferrer"
          class="popup-venue-address"
          title="${escapeHtml(t('popup.get_directions_osm'))}"
        >${escapeHtml(node.address)}</a>`
      : '';

  const activitiesHtml = !past && node.event_activities?.length
    ? `${descriptionHtml ? '<hr class="popup-divider" aria-hidden="true">' : ''}<div class="popup-activities">${node.event_activities.map(a => `<span class="popup-activity-tag">${escapeHtml(a)}</span>`).join('')}
        <span class="popup-activity-overflow" tabindex="0" aria-label="${escapeHtml(node.event_activities.join(', '))}" title="${escapeHtml(node.event_activities.join(', '))}" hidden>
          <span class="popup-activity-tag popup-activity-count"></span>
        </span>
      </div>`
    : '';

  return `
    <div class="popup-content${past ? ' popup-content--past' : ''}">
      ${placeholderBanner}
      <p class="popup-eyebrow">${escapeHtml(t('panel.event_eyebrow'))}</p>
      <div class="popup-header-row">
        <h3 class="popup-name">${escapeHtml(node.event_name)}</h3>
        ${onlineBadgeHtml}
      </div>
      ${organizingEntityHtml}
      <div class="popup-info-card">
        <p class="popup-date">${dateLineContent}</p>
        ${node.location_tbd && past ? '' : `<div class="popup-venue">
          ${venueNameHtml}
          ${past ? '' : venueAddressHtml}
        </div>`}
      </div>
      <div class="popup-body">
        ${descriptionHtml}
        ${activitiesHtml}
        <button class="read-more" data-node-id="${escapeHtml(node.id)}" aria-label="${escapeHtml(t('popup.see_details'))} ${escapeHtml(node.event_name)}">${t('popup.see_details')} &rarr;</button>
      </div>
      ${past ? `<div class="popup-past-event">
        <div class="past-event-notice">${escapeHtml(t('panel.event_over'))}</div>
        <button type="button" data-hide-past-events>${escapeHtml(t('filters.hide_past'))}</button>
      </div>` : ''}
    </div>
  `.trim();
}
