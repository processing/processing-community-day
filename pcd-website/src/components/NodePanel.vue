<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { createFocusTrap, type FocusTrap } from 'focus-trap';
import { Icon } from '@iconify/vue';
import type { Node } from '../lib/nodes';
import { formatDateRange, formatTimeRange, calendarLinks, onlinePlatformName, isPastEvent } from '../lib/format';
import { cartoTileUrl } from '../lib/carto';
import { getOsmUrl } from '../lib/popup';
import { GITHUB_EDIT_EVENT_URL, GITHUB_CONTENT_ISSUE_URL } from '../config';
import ShareMenu from './ShareMenu.vue';
import EventForumThread from './EventForumThread.vue';
import externalLinkIcon from '../icons/external-link.svg?raw';

const props = defineProps<{
  node: Node | null;
}>();

const emit = defineEmits<{
  close: [];
  'hide-past-events': [];
}>();

const { t, locale } = useI18n();
const dateBadge = computed(() => {
  if (!props.node?.event_date || props.node.date_tbd) return null;
  const date = new Date(`${props.node.event_date}T00:00:00Z`);
  return {
    month: new Intl.DateTimeFormat(locale.value, { month: 'short', timeZone: 'UTC' }).format(date),
    day: new Intl.DateTimeFormat(locale.value, { day: 'numeric', timeZone: 'UTC' }).format(date),
  };
});
const panelRef = ref<HTMLElement | null>(null);
const tabButtonRef = ref<HTMLButtonElement | null>(null);
const minimapRef = ref<HTMLDivElement | null>(null);
const descContentRef = ref<HTMLElement | null>(null);
const calDropdownOpen = ref(false);
const descExpanded = ref(false);
const descHasMore = ref(false);
const hostsExpanded = ref(false);
let trap: FocusTrap | null = null;
let minimap: import('leaflet').Map | null = null;

// Collapsed height of the description, in px. Must match the max-height set on
// .panel-description-content--clamped in the styles below.
const DESC_CLAMP_PX = 240;
const HOSTS_VISIBLE = 3;

function handleOutsideClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (calDropdownOpen.value && !target.closest('.info-card-calendar-row')) {
    calDropdownOpen.value = false;
  }
}

onMounted(() => {
  if (panelRef.value) {
    trap = createFocusTrap(panelRef.value, {
      initialFocus: () => {
        if (tabButtonRef.value && tabButtonRef.value.offsetParent !== null) {
          return tabButtonRef.value;
        }
        return panelRef.value!;
      },
      onDeactivate: () => emit('close'),
      returnFocusOnDeactivate: false,
      escapeDeactivates: true,
      allowOutsideClick: true,
      fallbackFocus: () => panelRef.value!,
    });
  }
  document.addEventListener('click', handleOutsideClick);
  window.addEventListener('resize', measureDesc);
});

onUnmounted(() => {
  trap?.deactivate();
  destroyMinimap();
  document.removeEventListener('click', handleOutsideClick);
  window.removeEventListener('resize', measureDesc);
});

// Decide whether the description overflows its collapsed height and needs a
// "read more" toggle. scrollHeight reports full content height regardless of
// the clamp's max-height, so this works whether or not the clamp is applied.
async function measureDesc() {
  await nextTick();
  const el = descContentRef.value;
  descHasMore.value = !!el && el.scrollHeight > DESC_CLAMP_PX + 8;
}

function destroyMinimap() {
  if (minimap) {
    minimap.remove();
    minimap = null;
  }
}

async function initMinimap(node: Node) {
  await nextTick();
  if (!minimapRef.value) return;
  destroyMinimap();

  const L = (await import('leaflet')).default;

  minimap = L.map(minimapRef.value, {
    center: [node.lat, node.lng],
    zoom: 16,
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    touchZoom: false,
    tap: false,
  } as L.MapOptions & { tap: boolean });

  L.tileLayer(cartoTileUrl('rastertiles/voyager'), {
    subdomains: 'abcd',
    maxZoom: 20,
  }).addTo(minimap);

  const pinIcon = L.divIcon({
    className: '',
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 22 14 22S28 23.333 28 14C28 6.268 21.732 0 14 0z" fill="#3b5fc0"/>
      <circle cx="14" cy="14" r="5.5" fill="#ffffff"/>
    </svg>`,
    iconSize: [28, 36],
    iconAnchor: [14, 36],
  });
  const marker = L.marker([node.lat, node.lng], { icon: pinIcon }).addTo(minimap);
  // The minimap is aria-hidden; remove keyboard focusability from the marker element.
  const markerEl = marker.getElement();
  if (markerEl) markerEl.setAttribute('tabindex', '-1');
}

watch(
  () => props.node,
  async (newNode) => {
    calDropdownOpen.value = false;
    descExpanded.value = false;
    descHasMore.value = false;
    hostsExpanded.value = false;
    if (newNode) {
      await nextTick();
      trap?.activate();
      measureDesc();
      if (!newNode.online_event && !newNode.location_tbd) initMinimap(newNode);
      else destroyMinimap();
    } else {
      trap?.deactivate();
      destroyMinimap();
      document.getElementById('map')?.focus();
    }
  }
);

function downloadIcs(node: Node) {
  const { icsContent } = calendarLinks(node);
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${node.id}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


type Organizer = { name: string; name_html: string };

function getOrganizers(organizers: Organizer[]): Organizer[] {
  return organizers.filter(o => o.name);
}

// Join organizer names as inline HTML (names support markdown, so name_html
// carries the rendered markup). The separator is plain text between spans.
function formatOrganizers(organizers: Organizer[], expanded = false): string {
  const list = getOrganizers(organizers);
  const visible = expanded ? list : list.slice(0, HOSTS_VISIBLE);
  return visible.map(o => o.name_html).join(', ');
}

function hasMoreHosts(organizers: Organizer[]): boolean {
  return getOrganizers(organizers).length > HOSTS_VISIBLE;
}

function getShareUrl(node: Node): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${window.location.origin}${base}/event/${node.id}-${node.uid}/`;
}

function getShareMarkdown(node: Node): string {
  return [
    `# ${node.event_name}`,
    node.event_short_description,
    node.details_markdown,
  ].filter(Boolean).join('\n\n');
}

function getReportIssueHref(node: Node): string {
  return `${GITHUB_CONTENT_ISSUE_URL}&event=${encodeURIComponent(node.event_name)}&event_page_url=${encodeURIComponent(getShareUrl(node))}`;
}

function getEditEventHref(node: Node): string {
  const params = new URLSearchParams();
  params.set('canonical_id', `${node.id}-${node.uid}`);
  params.set('event_name', node.event_name);
  if (node.forum_thread_url) params.set('forum_thread_url', node.forum_thread_url);
  params.set('plus_code', node.plus_code);
  if (node.event_url) params.set('online_event_url', node.event_url);
  params.set('primary_contact_name', node.primary_contact.name);
  params.set('contact_email', node.primary_contact.email);
  if (node.city) params.set('city', node.city);
  if (node.country) params.set('country', node.country);
  if (node.organization_name) params.set('organization_name', node.organization_name);
  if (node.organization_url) params.set('organization_url', node.organization_url);
  if (node.address) params.set('address', node.address);
  if (node.event_date) params.set('event_date', node.event_date);
  if (node.event_end_date) params.set('event_end_date', node.event_end_date);
  if (node.event_start_time) params.set('event_start_time', node.event_start_time);
  if (node.event_end_time) params.set('event_end_time', node.event_end_time);
  if (node.event_page_url) params.set('event_page_url', node.event_page_url);
  if (node.organizers.length) params.set('organizers', node.organizers.map(o => o.name).join('\n'));
  params.set('short_description', node.event_short_description);
  if (node.details_markdown) params.set('full_description', node.details_markdown);
  const formatValue = node.online_event ? `Online` : `In person`;
  const refLines: string[] = [];
  refLines.push(`     Event format: "${formatValue}"`);
  if (node.organization_type) refLines.push(`     Organization type: "${node.organization_type}"`);
  if (node.event_activities.length) {
    refLines.push(`     Event activities:`);
    node.event_activities.forEach(a => refLines.push(`     - "${a}"`));
  }
  if (refLines.length) {
    params.set('maintainer_notes', [
      '<!-- ⚠️ GitHub does not support pre-filling dropdown or checkbox fields via URL ⚠️',
      '',
      '     Use the form fields above to enter or update the information.',
      '',
      '     Recorded data for reference only. Do NOT edit this section:',
      '',
      ...refLines,
      '',
      '-->',
    ].join('\n'));
  }
  params.set('title', `Edit data for **${node.event_name}**`);
  return `${GITHUB_EDIT_EVENT_URL}&${params.toString().replace(/\+/g, '%20')}`;
}

const calLinks = computed(() => props.node && !props.node.date_tbd && !isPastEvent(props.node) ? calendarLinks(props.node) : null);
</script>

<template>
  <aside
    ref="panelRef"
    role="dialog"
    :aria-modal="node !== null"
    aria-labelledby="panel-title"
    tabindex="-1"
    :inert="node === null"
    :class="['node-panel', { 'node-panel--open': node !== null }]"
  >
    <button
      v-if="node !== null"
      ref="tabButtonRef"
      class="panel-tab"
      :aria-label="t('panel.close_details')"
      @click="emit('close')"
    >
      <Icon icon="bi:chevron-right" width="1em" height="1em" aria-hidden="true" />
    </button>

    <div class="panel-scroll">
    <template v-if="node">
      <div class="panel-mobile-back">
        <button type="button" class="panel-back-btn" @click="emit('close')">
          <Icon icon="bi:arrow-left" width="1em" height="1em" aria-hidden="true" />
          {{ t('panel.back_to_map') }}
        </button>
      </div>
      <div class="panel-content">
        <div v-if="node.placeholder" class="panel-placeholder">
          {{ t('panel.placeholder_warning') }}
        </div>

        <div class="panel-header-row">
          <div class="panel-heading">
            <p class="panel-eyebrow">{{ t('panel.event_eyebrow') }}</p>
            <h2 id="panel-title" class="panel-name">{{ node.event_name }}</h2>
          </div>
          <ShareMenu
            class="panel-share-menu"
            :markdown="getShareMarkdown(node)"
            :permalink="getShareUrl(node)"
            :qr-filename="`${node.id}-qr-code.png`"
          />
        </div>

        <!-- Info Card -->
        <div class="panel-info-card">
          <!-- Date/time and calendar action -->
          <div class="info-card-row info-card-date-row">
            <div v-if="dateBadge" class="info-card-date-badge" aria-hidden="true">
              <span class="info-card-date-badge-month">{{ dateBadge.month }}</span>
              <span class="info-card-date-badge-day">{{ dateBadge.day }}</span>
            </div>
            <Icon v-else icon="bi:calendar-event" width="1em" height="1em" aria-hidden="true" class="info-card-icon" />
            <div class="info-card-date-details">
              <span v-if="node.date_tbd" class="date-tbd-pill">{{ t('panel.date_tbd') }}</span>
              <div v-else class="info-card-date-line">
                <span class="info-card-date">{{ formatDateRange(node.event_date ?? '', node.event_end_date, false, locale) }}</span>
                <template v-if="isPastEvent(node)">
                  <span class="date-tbd-pill past-event-pill">{{ t('panel.past_event') }}</span>
                  <button type="button" class="hide-past-events-link" @click="emit('hide-past-events')">{{ t('filters.hide_past') }}</button>
                </template>
                <span v-if="node.event_start_time" class="info-card-time">
                  {{ formatTimeRange(node.event_start_time, node.event_end_time) }}<span class="info-card-time-note">{{ t('panel.local_time') }}</span>
                </span>
                <span v-else-if="node.time_tbd && !isPastEvent(node)" class="date-tbd-pill time-tbd-pill">{{ t('panel.time_tbd') }}</span>
              </div>
              <div v-if="!node.date_tbd && !isPastEvent(node)" class="info-card-cal-trigger-wrap info-card-calendar-row">
                <button
                  class="info-card-cal-trigger"
                  :aria-label="t('panel.add_to_calendar')"
                  aria-haspopup="menu"
                  :aria-expanded="calDropdownOpen"
                  @click.stop="calDropdownOpen = !calDropdownOpen"
                >
                  {{ t('panel.add_to_calendar') }}
                </button>
                <div v-show="calDropdownOpen" class="quick-action-menu" role="menu">
                  <a
                    :href="calLinks!.googleCalUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    role="menuitem"
                    :aria-label="t('panel.google_calendar_new_tab')"
                    @click="calDropdownOpen = false"
                  >{{ t('panel.google_calendar') }}</a>
                  <a
                    :href="calLinks!.outlookCalUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    role="menuitem"
                    :aria-label="t('panel.outlook_new_tab')"
                    @click="calDropdownOpen = false"
                  >{{ t('panel.outlook') }}</a>
                  <button role="menuitem" @click="downloadIcs(node); calDropdownOpen = false">
                    {{ t('panel.download_ics') }}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <!-- Venue + address (OSM link) or Online platform -->
          <template v-if="node.online_event || !node.location_tbd || !isPastEvent(node)">
            <div class="info-card-row info-card-venue-row">
              <div class="info-card-row-leading">
                <Icon :icon="!node.online_event ? 'bi:geo-alt' : 'bi:link-45deg'" width="1em" height="1em" aria-hidden="true" class="info-card-icon" />
                <div class="info-card-venue">
                  <span v-if="!node.online_event && node.location_tbd" class="date-tbd-pill date-tbd-pill--location-tbd">{{ t('panel.location_tbd') }}</span>
                  <span v-else class="info-card-venue-name">{{ node.online_event ? onlinePlatformName(node.event_url) : (node.location_name || node.address) }}</span>
                  <a
                    v-if="node.online_event && node.event_url"
                    :href="node.event_url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="info-card-venue-address"
                    :title="t('panel.join_online')"
                  >{{ node.event_url }}</a>
                  <a
                    v-else-if="!node.online_event && !node.location_tbd && node.address"
                    :href="getOsmUrl(node)"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="info-card-venue-address info-card-osm-link"
                    :title="t('panel.get_directions_osm')"
                  >{{ node.location_name ? node.address : t('panel.view_osm') }}</a>
                </div>
              </div>
              <p v-if="node.online_event" class="panel-online-badge info-card-online-badge">
                <Icon icon="bi:wifi" width="1em" height="1em" aria-hidden="true" />
                {{ t('panel.online_event') }}
              </p>
            </div>
          </template>
        </div>

        <!-- Event and forum actions -->
        <div
          v-if="node.event_page_url || node.forum_thread_url"
          class="panel-hero-actions"
          role="region"
          aria-labelledby="panel-hero-heading"
          :class="{ 'panel-hero-actions--both': node.event_page_url && node.forum_thread_url, 'panel-hero-actions--forum-only': !node.event_page_url }"
        >
          <h2 id="panel-hero-heading" class="panel-hero-heading">{{ t(isPastEvent(node) ? 'panel.more_about_pcd' : 'panel.find_out_more') }}</h2>
          <a
            v-if="node.event_page_url"
            :href="node.event_page_url"
            target="_blank"
            rel="noopener noreferrer"
            class="panel-event-website-btn"
            :aria-label="t('panel.visit_event_page_new_tab')"
          >{{ t('panel.event_page') }} <span class="panel-event-website-icon" aria-hidden="true" v-html="externalLinkIcon"></span></a>
          <EventForumThread v-if="node.forum_thread_url" :key="node.forum_thread_url" :url="node.forum_thread_url" :stacked="!!node.event_page_url">
            <a
              :href="node.forum_thread_url"
              target="_blank"
              rel="noopener noreferrer"
              class="panel-event-website-btn panel-event-website-btn--secondary"
              :aria-label="t('panel.visit_forum_thread_new_tab')"
            >{{ t('panel.forum_thread') }} <span class="panel-event-website-icon" aria-hidden="true" v-html="externalLinkIcon"></span></a>
          </EventForumThread>
        </div>

        <div v-if="node.organization_name || node.organizers.some(o => o.name)" class="panel-byline">
          <section v-if="node.organizers.some(o => o.name)" aria-labelledby="panel-hosted-heading">
            <h2 id="panel-hosted-heading" class="panel-section-heading">{{ t('panel.hosted_by') }}</h2>
            <p class="panel-hosts">
              <span v-if="!hostsExpanded" class="panel-hosts-line">
                <span class="panel-hosts-names panel-inline-md" v-html="formatOrganizers(node.organizers, false)"></span><template v-if="hasMoreHosts(node.organizers)"><span class="panel-hosts-more-wrap">…&nbsp;<button class="panel-hosts-more" :aria-label="t('panel.show_all_hosts')" @click="hostsExpanded = true">{{ t('panel.more') }}</button></span></template>
              </span>
              <span v-else class="panel-inline-md" v-html="formatOrganizers(node.organizers, true)"></span>
            </p>
          </section>
          <section v-if="node.organization_name" aria-labelledby="panel-organized-heading">
            <h2 id="panel-organized-heading" class="panel-section-heading">{{ t('panel.organized_by') }}</h2>
            <p class="panel-organizing-entity panel-inline-md" v-html="node.organization_name_html"></p>
          </section>
        </div>

        <section v-if="node.details_html || node.event_activities?.length" class="panel-about" aria-labelledby="panel-about-heading">
          <h2 id="panel-about-heading" class="panel-section-heading">{{ t('panel.about_event') }}</h2>
          <!-- Description -->
          <div v-if="node.details_html" class="panel-description">
            <!-- details_html is rendered from PR-reviewed markdown; micromark escapes
                 raw HTML and sanitizes link protocols at build time. -->
            <div
              ref="descContentRef"
              class="panel-description-content markdown-body"
              :class="{ 'panel-description-content--clamped': !descExpanded && descHasMore }"
              v-html="node.details_html"
            ></div>
            <button
              v-if="descHasMore"
              class="panel-read-more"
              :aria-expanded="descExpanded"
              @click="descExpanded = !descExpanded"
            >
              {{ descExpanded ? t('panel.show_less') : t('panel.read_more') }}
            </button>
          </div>

          <div v-if="node.event_activities?.length" class="panel-activity-tags">
            <span
              v-for="activity in node.event_activities"
              :key="activity"
              class="panel-activity-tag"
            >{{ activity }}</span>
          </div>
        </section>

        <!-- Minimap (hidden for online events and TBD locations) -->
        <div v-if="!node.online_event && !node.location_tbd" class="panel-minimap-wrap">
          <div ref="minimapRef" class="panel-minimap" aria-hidden="true"></div>
          <div class="panel-minimap-shield" aria-hidden="true"></div>
          <a
            :href="getOsmUrl(node)"
            target="_blank"
            rel="noopener noreferrer"
            class="panel-minimap-directions"
            :title="t('panel.get_directions_osm')"
          >
            <Icon icon="bi:map" width="1em" height="1em" aria-hidden="true" />
            {{ t('panel.get_directions') }}
          </a>
        </div>

        <!-- Disclaimer -->
        <template v-if="!node.organization_name?.toLowerCase().includes('processing foundation')">
          <hr class="panel-separator" aria-hidden="true" />
          <i18n-t
            v-if="node.primary_contact.email"
            :keypath="node.organization_name ? 'panel.disclaimer_with_org_email' : 'panel.disclaimer_without_org_email'"
            tag="p"
            class="panel-disclaimer panel-inline-md"
          >
            <template #org><em v-html="node.organization_name_html"></em></template>
            <template #email><a :href="`mailto:${node.primary_contact.email}`">{{ node.primary_contact.email }}</a></template>
          </i18n-t>
          <!-- disclaimer_with_org wraps {org} in <em>; org name may itself
               contain PR-reviewed inline markdown, so inject as HTML. -->
          <p
            v-else-if="node.organization_name"
            class="panel-disclaimer panel-inline-md"
            v-html="t('panel.disclaimer_with_org', { org: node.organization_name_html })"
          ></p>
          <p v-else class="panel-disclaimer">
            {{ t('panel.disclaimer_without_org') }}
          </p>
        </template>

        <template v-else-if="node.primary_contact.email">
          <hr class="panel-separator" aria-hidden="true" />
          <i18n-t keypath="panel.contact_organizers_email" tag="p" class="panel-disclaimer">
            <template #email><a :href="`mailto:${node.primary_contact.email}`">{{ node.primary_contact.email }}</a></template>
          </i18n-t>
        </template>

        <!-- Report issue / Edit event -->
        <div class="panel-report">
          <hr class="panel-separator" aria-hidden="true" />
          <div class="panel-report-row">
            <a
              :href="getEditEventHref(node)"
              class="panel-link-row panel-report-link"
              :title="t('panel.edit_event')"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon icon="bi:github" width="1em" height="1em" aria-hidden="true" class="panel-link-icon" />
              <span>{{ t('panel.edit_event') }}</span>
            </a>
            <a
              :href="getReportIssueHref(node)"
              class="panel-link-row panel-report-link"
              :title="t('panel.report_issue')"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon icon="bi:flag" width="1em" height="1em" aria-hidden="true" class="panel-link-icon" />
              <span>{{ t('panel.report_issue') }}</span>
            </a>
          </div>
        </div>
      </div>
    </template>
    </div>
  </aside>
</template>

<style scoped>
.node-panel {
  position: fixed;
  top: var(--header-height);
  right: 0;
  height: calc(100% - var(--header-height));
  width: clamp(320px, 40vw, 520px);
  background: transparent;
  filter: drop-shadow(-4px 0 16px rgba(0, 0, 0, 0.18));
  z-index: var(--z-panel);
  transform: translateX(100%);
  transition: var(--transition-panel);
  overflow: visible;
  display: flex;
  flex-direction: column;
}

.node-panel--open {
  transform: translateX(0);
}

.panel-scroll {
  flex: 1;
  overflow-y: auto;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-panel);
  position: relative;
  z-index: 1;
}

.panel-tab {
  --tab-r: 12px;
  position: absolute;
  left: 1px;
  top: 50%;
  transform: translate(-100%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 96px;
  background: var(--color-bg-popup);
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  padding: 0;
  z-index: 0;
  /* drop-shadow renders along the clipped shape outline, acting as a border */
  filter: drop-shadow(-1px 0 0 var(--color-border))
          drop-shadow(0 -1px 0 var(--color-border))
          drop-shadow(0 1px 0 var(--color-border));
  transition: background-color 0.12s ease, color 0.12s ease, filter 0.12s ease;
  clip-path: shape(
    /*
     * Vertical tab, right edge meets the panel.
     * Adapted from the horizontal tab example by rotating 90° CW:
     * concave corners on the right, convex on the left.
     */
    from top right,
    /* 1. Concave top-right */
    curve to calc(100% - var(--tab-r)) var(--tab-r)
      with 100% var(--tab-r),
    /* 2. Top edge ← */
    hline to var(--tab-r),
    /* 3. Convex top-left */
    curve to 0 calc(var(--tab-r) * 2)
      with 0 var(--tab-r),
    /* 4. Left edge ↓ */
    vline to calc(100% - calc(var(--tab-r) * 2)),
    /* 5. Convex bottom-left */
    curve to var(--tab-r) calc(100% - var(--tab-r))
      with 0 calc(100% - var(--tab-r)),
    /* 6. Bottom edge → */
    hline to calc(100% - var(--tab-r)),
    /* 7. Concave bottom-right */
    curve to 100% 100%
      with 100% calc(100% - var(--tab-r))
  );

  @supports not (clip-path: shape(from top left, hline to 0)) {
    left: 4px;
    border: 1px solid var(--color-border);
    border-right: none;
    border-radius: 12px 0 0 12px;
    clip-path: none;
  }
}

.panel-tab:hover {
  background: var(--color-bg-popup-hover);
  color: var(--color-text);
}

.panel-tab:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.panel-mobile-back {
  display: none;
  padding: var(--spacing-sm) var(--spacing-lg) 0;
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--color-bg-panel);
}

.panel-back-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-height: 44px;
  padding: 0.5rem 0;
  border: none;
  background: transparent;
  color: var(--color-primary);
  font: 600 0.875rem/1.3 var(--font-family);
  cursor: pointer;
}

.panel-back-btn:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

@media (max-width: 720px) {
  .node-panel {
    width: 100vw;
    overflow: hidden;
  }
  .panel-tab {
    display: none;
  }
  .panel-mobile-back {
    display: block;
  }
}

.panel-content {
  padding: 1.5rem 1.5rem 2rem;
}

.panel-placeholder {
  background: var(--color-callout-placeholder-bg);
  border: 1px solid var(--color-callout-placeholder-border);
  border-radius: 4px;
  padding: 0.625rem 0.875rem;
  font-size: 0.875rem;
  line-height: 1.45;
  margin-bottom: 1rem;
  color: var(--color-callout-placeholder-text);
}


.panel-eyebrow {
  margin: 0 0 0.375rem;
  color: var(--color-text-muted);
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.panel-header-row {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

.panel-byline {
  display: grid;
  gap: 1.25rem;
  margin-bottom: 1.25rem;
}

.panel-heading {
  flex: 1;
  min-width: 0;
}

.panel-name {
  color: var(--color-text);
  min-width: 0;
  margin: 0 0 0.2rem;
  font-size: 1.75rem;
  font-weight: 600;
  line-height: 1.3;
}

.panel-online-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  margin: 0 0 0.375rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
  border-radius: 4px;
  padding: 0.2em 0.55em;
}

.info-card-online-badge {
  margin: 0;
  align-self: flex-start;
  white-space: nowrap;
}

.info-card-tbd {
  font-style: italic;
  color: var(--color-text-muted);
}

.panel-activity-tags {
  margin-bottom: 1rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4em;
}

.panel-activity-tag {
  display: inline-flex;
  align-items: center;
  font-size: 0.75rem;
  font-weight: 500;
  padding: 0.2em 0.55em;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-panel);
  color: var(--color-text-subtle);
  text-transform: capitalize;
}

/* Inline markdown rendered via v-html (host/org names, disclaimer). */
.panel-inline-md :deep(em) {
  font-style: italic;
}

.panel-inline-md :deep(strong) {
  font-weight: 600;
}

.panel-inline-md :deep(a) {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.panel-inline-md :deep(a:hover),
.panel-disclaimer :deep(a:hover),
.info-card-venue-address:hover {
  color: var(--color-link-hover);
}

.panel-inline-md :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
}

.panel-organizing-entity {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text);
}

.panel-hosts {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text);
  display: flex;
  align-items: baseline;
  gap: 0.3em;
  overflow: hidden;
}

.panel-hosts-line {
  display: flex;
  align-items: baseline;
  min-width: 0;
  flex: 1;
}

.panel-hosts-names {
  overflow: hidden;
  white-space: nowrap;
  min-width: 0;
  flex-shrink: 1;
}

.panel-hosts-more-wrap {
  flex-shrink: 0;
  white-space: nowrap;
}

.panel-hosts-more {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: var(--font-family);
  font-size: inherit;
  color: var(--color-text-muted);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.panel-hosts-more:hover {
  color: var(--color-text);
}

/* ─── Event and forum actions ─── */
.panel-hero-actions {
  margin-bottom: 1.5rem;
}

.panel-hero-heading {
  grid-column: 1 / -1;
}

.panel-hero-heading,
.panel-section-heading {
  margin: 0 0 0.75rem;
  padding: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.4;
}

.panel-hero-actions--both .panel-hero-heading {
  margin-bottom: 0;
}

.panel-hero-actions--both {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 12px;
}

@media (max-width: 640px) {
  .panel-hero-actions--both {
    grid-template-columns: minmax(0, 1fr);
  }
}

.panel-hero-actions--forum-only .panel-event-website-btn {
  width: auto;
  flex: 1 0 auto;
}

.panel-event-website-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  width: 100%;
  min-height: 44px;
  padding: 0.625rem 0.75rem;
  background: var(--color-primary);
  color: #fff;
  text-align: center;
  text-decoration: none;
  font-size: 0.9375rem;
  font-weight: 600;
  border-radius: 6px;
  box-sizing: border-box;
}

.panel-event-website-btn--secondary {
  padding: 0.625rem 1rem;
  background: transparent;
  color: var(--color-primary);
  border: 1px solid var(--color-primary);
  line-height: 1.5;
  transition: opacity 0.15s ease;
}

.panel-event-website-btn--secondary:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.panel-event-website-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  opacity: 0.75;
}

.panel-event-website-icon :deep(svg) {
  width: 20px;
  height: 20px;
}

.panel-event-website-btn:hover {
  opacity: 0.85;
}

/* ─── Info Card ─── */
.panel-info-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 1.5rem;
}

.info-card-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.info-card-row-leading {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
  min-width: 0;
}

.info-card-row.info-card-venue-row {
  justify-content: space-between;
}

.info-card-icon,
.info-card-date-badge {
  box-sizing: border-box;
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
  border: 1px solid var(--color-purple-300);
  border-radius: 8px;
  color: var(--color-purple-900);
}

.info-card-icon {
  padding: 10px;
}

.info-card-date-badge {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  overflow: hidden;
  text-align: center;
}

.info-card-date-badge-month {
  background: var(--color-purple-700);
  color: #fff;
  font-size: .5625rem;
  font-weight: 600;
  line-height: 15px;
  text-transform: uppercase;
}

.info-card-date-badge-day {
  font-size: 1rem;
  font-weight: 600;
  line-height: 23px;
}

.info-card-date-details,
.info-card-venue {
  min-width: 0;
  overflow-wrap: anywhere;
}

.info-card-date-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.125rem 0.75rem;
}

.info-card-date-line .time-tbd-pill,
.info-card-date-line .past-event-pill {
  padding-block: 0;
  align-self: center;
}

.info-card-date {
  display: block;
  font-weight: 600;
  font-size: 0.9375rem;
  color: var(--color-text);
  line-height: 1.35;
}

.info-card-time {
  font-size: 0.875rem;
  line-height: 1.4;
  color: var(--color-text-muted);
}

.info-card-time-note {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  opacity: 0.7;
  margin-left: 0.25em;
}

.info-card-venue {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.info-card-venue-name {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.35;
}

.info-card-venue-address {
  font-size: 0.875rem;
  line-height: 1.4;
}

/* ─── Calendar action below date details ─── */
.info-card-date-row .info-card-date-details {
  flex: 1;
}

.info-card-cal-trigger-wrap {
  position: relative;
  margin-top: 2px;
}

.info-card-cal-trigger-wrap .quick-action-menu {
  left: 0;
  right: auto;
}

.info-card-cal-trigger {
  display: block;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: var(--font-family);
  font-size: 0.875rem;
  color: var(--color-primary);
  line-height: 1.4;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
}

.info-card-cal-trigger:hover {
  color: var(--color-link-hover);
}

/* ─── Calendar dropdown menu ─── */
.quick-action-menu {
  position: absolute;
  left: 0;
  z-index: 1001;
  top: calc(100% + 4px);
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 4px;
  min-width: 160px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
}

.quick-action-menu a,
.quick-action-menu button {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  text-align: left;
  font-size: 0.875rem;
  color: var(--color-text);
  text-decoration: none;
  background: none;
  border: none;
  cursor: pointer;
  border-radius: 4px;
  font-family: var(--font-family);
}

.quick-action-menu a:hover,
.quick-action-menu button:hover {
  background: var(--color-border);
}

/* ─── Minimap ─── */
.panel-minimap-wrap {
  position: relative;
  outline: 1px solid var(--color-border);
  width: 100%;
  border-radius: 12px;
  aspect-ratio: 18 / 9;
  margin-bottom: 1.25rem;
  overflow: hidden;
}

.panel-minimap {
  width: 100%;
  height: 100%;
}

.panel-minimap-directions {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1001;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-panel);
  color: var(--color-text);
  box-shadow: 0 2px 6px rgb(0 0 0 / 12%);
  font-size: 0.8125rem;
  text-decoration: none;
}

.panel-minimap-directions:hover {
  color: var(--color-primary);
}

.panel-minimap-directions:focus-visible {
  outline-offset: -4px;
}

.panel-minimap-shield {
  position: absolute;
  inset: 0;
  z-index: 1000;
}

.panel-share-menu :deep(.share-menu__items) {
  right: 0;
  left: auto;
}

/* ─── Description ─── */
.panel-about {
  margin-bottom: 1.25rem;
}

.panel-description {
  margin-bottom: 1rem;
}

.panel-description-content {
  font-size: 0.9375rem;
  line-height: 1.6;
}

/* Collapse long descriptions behind a "read more" toggle. The max-height here
   must match DESC_CLAMP_PX in the script. */
.panel-description-content--clamped {
  max-height: 240px;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(to bottom, #000 60%, transparent 100%);
  mask-image: linear-gradient(to bottom, #000 60%, transparent 100%);
}

/* ─── Rendered markdown (v-html, so :deep is required) ─── */
.panel-description-content :deep(> *:first-child) {
  margin-top: 0;
}

.panel-description-content :deep(> *:last-child) {
  margin-bottom: 0;
}

.panel-description-content :deep(p) {
  margin: 0 0 0.75rem;
}

.panel-description-content :deep(a) {
  color: var(--color-text);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.panel-description-content :deep(a:hover) {
  color: var(--color-text);
}

.panel-description-content :deep(h1),
.panel-description-content :deep(h2),
.panel-description-content :deep(h3),
.panel-description-content :deep(h4) {
  margin: 1.25rem 0 0.5rem;
  font-weight: 600;
  line-height: 1.3;
}

.panel-description-content :deep(h1) { font-size: 1.25rem; }
.panel-description-content :deep(h2) { font-size: 1.125rem; }
.panel-description-content :deep(h3) { font-size: 1rem; }
.panel-description-content :deep(h4) { font-size: 0.9375rem; }

.panel-description-content :deep(ul),
.panel-description-content :deep(ol) {
  margin: 0 0 0.75rem;
  padding-left: 1.5rem;
}

.panel-description-content :deep(li) {
  margin: 0.2rem 0;
}

.panel-description-content :deep(blockquote) {
  margin: 0 0 0.75rem;
  padding-left: 0.875rem;
  border-left: 3px solid var(--color-border);
  color: var(--color-text-muted);
}

.panel-description-content :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85em;
  background: var(--color-border);
  padding: 0.1em 0.35em;
  border-radius: 4px;
}

.panel-description-content :deep(pre) {
  margin: 0 0 0.75rem;
  padding: 0.75rem;
  background: var(--color-border);
  border-radius: 6px;
  overflow-x: auto;
}

.panel-description-content :deep(pre code) {
  background: none;
  padding: 0;
}

.panel-description-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}

.panel-description-content :deep(hr) {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 1rem 0;
}

.panel-description-content :deep(table) {
  border-collapse: collapse;
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
}

.panel-description-content :deep(th),
.panel-description-content :deep(td) {
  border: 1px solid var(--color-border);
  padding: 0.3rem 0.55rem;
  text-align: left;
}

.panel-read-more {
  margin-top: 0.5rem;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: var(--font-family);
  font-size: 0.875rem;
  color: var(--color-text-muted);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.panel-read-more:hover {
  color: var(--color-text);
}

/* ─── Disclaimer and report actions ─── */
.panel-disclaimer {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  line-height: 1.5;
  margin-bottom: 1rem;
}

.panel-disclaimer :deep(a),
.info-card-venue-address {
  color: var(--color-primary);
  overflow-wrap: anywhere;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.info-card-venue-address.info-card-osm-link {
  text-decoration-style: dotted;
}

.panel-report-row {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.panel-report-link {
  color: var(--color-text-muted);
}

.panel-report-link:hover {
  color: var(--color-link);
}

.panel-separator {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 0 0 0.75rem;
}

.panel-link-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0;
  text-decoration: none;
  color: var(--color-text);
  font-size: 0.875rem;
  overflow: hidden;
}

.panel-link-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-link-row:hover {
  color: var(--color-link);
}

.panel-link-icon {
  flex-shrink: 0;
  color: var(--color-text-muted);
}

</style>
