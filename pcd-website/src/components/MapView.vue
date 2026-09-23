<script setup lang="ts">
import { computed, nextTick, ref, watch, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import type { Node } from '../lib/nodes';
import { makePopupContent, fitPopupActivities } from '../lib/popup';
import { isPastEvent } from '../lib/format';
import NodePanel from './NodePanel.vue';
import LanguageSwitcher from './LanguageSwitcher.vue';
import InfoModal from './InfoModal.vue';
import SubmitModal from './SubmitModal.vue';
import EyelidBlink from './EyelidBlink.vue';
import { currentLocale } from '../i18n/localeState';
import { trackEvent, SUBMIT_EVENT_BUTTON_CLICK } from '../lib/analytics';
import { cartoTileUrl } from '../lib/carto';
import { safeStorage } from '../lib/safeStorage.mjs';
import { i18n } from '../i18n/index';
import calendarIcon from '../icons/calendar.svg?raw';
import questionMarkIcon from '../icons/question-mark.svg?raw';

const props = defineProps<{
  nodes: Node[];
  initialEventId?: string;
  bannerImageUrl?: string;
}>();

const { t } = useI18n();

const selectedNode = ref<Node | null>(null);
const filterPanelOpen = ref(false);
const FILTER_CLOSE_LEARNED_KEY = 'pcd-filter-close-learned';
const filterCloseLearned = ref(safeStorage.get(FILTER_CLOSE_LEARNED_KEY) === 'true');

function handleFilterTabClick() {
  filterCloseLearned.value = true;
  safeStorage.set(FILTER_CLOSE_LEARNED_KEY, 'true');
  closeFilterPanel();
}

const filterButtonRef = ref<HTMLButtonElement | null>(null);
const filterCloseRef = ref<HTMLButtonElement | null>(null);
const filterBackRef = ref<HTMLButtonElement | null>(null);
const dateCategories = ['future', 'past', 'other'] as const;
type DateCategory = typeof dateCategories[number];
const visibleDates = ref<DateCategory[]>([...dateCategories]);
const suppressedDateHover = ref<DateCategory | null>(null);
const blinking = ref(false);
const readjustingEye = ref<DateCategory | null>(null);
let lastHiddenDate: DateCategory = 'other';
const selectedFormats = ref<string[]>([]);
const selectedActivities = ref<string[]>([]);

const activityOptions = computed(() =>
  [...new Set(props.nodes.flatMap((node) => node.event_activities))].sort((a, b) => a.localeCompare(b))
);

function showAllDates() {
  if (blinking.value) return;
  visibleDates.value = [...dateCategories];
}

function blinkIfAllHidden() {
  if (visibleDates.value.length === 0) {
    readjustingEye.value = null;
    blinking.value = true;
  }
}

function restoreLastHiddenDate() {
  if (visibleDates.value.length === 0) visibleDates.value = [lastHiddenDate];
}

function finishBlink() {
  blinking.value = false;
  if (filterPanelOpen.value && !document.hidden &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    readjustingEye.value = lastHiddenDate;
  }
}

function toggleDateVisibility(category: DateCategory) {
  if (blinking.value) return;
  readjustingEye.value = null;
  if (!visibleDates.value.includes(category)) {
    visibleDates.value = [...visibleDates.value, category];
  } else {
    suppressedDateHover.value = category;
    lastHiddenDate = category;
    visibleDates.value = visibleDates.value.filter((value) => value !== category);
    blinkIfAllHidden();
  }
}

function matchesFilters(node: Node): boolean {
  const dateCategory = !node.event_date ? 'other' : isPastEvent(node) ? 'past' : 'future';
  const matchesDate = visibleDates.value.includes(dateCategory);
  const format = node.online_event ? 'online' : 'in-person';
  const matchesFormat = selectedFormats.value.length === 0 || selectedFormats.value.includes(format);
  const matchesActivity = selectedActivities.value.length === 0 ||
    node.event_activities.some((activity) => selectedActivities.value.includes(activity));
  return matchesDate && matchesFormat && matchesActivity;
}

const filteredNodes = computed(() => props.nodes.filter(matchesFilters));
const activeFilterCount = computed(() =>
  (visibleDates.value.length === dateCategories.length ? 0 : 1) +
  selectedFormats.value.length + selectedActivities.value.length
);

function toggleFilterPanel() {
  filterPanelOpen.value = !filterPanelOpen.value;
  if (filterPanelOpen.value) {
    mapInstance?.closePopup();
    closePanel();
    nextTick(() => {
      const closeButton = filterBackRef.value?.getClientRects().length
        ? filterBackRef.value
        : filterCloseRef.value;
      closeButton?.focus();
    });
  }
}

function closeFilterPanel({ refocus = true } = {}) {
  filterPanelOpen.value = false;
  if (refocus) nextTick(() => filterButtonRef.value?.focus());
}

function clearFilters() {
  showAllDates();
  selectedFormats.value = [];
  selectedActivities.value = [];
}

async function hidePastEvents() {
  mapInstance?.closePopup();
  closePanel();
  lastHiddenDate = 'past';
  visibleDates.value = visibleDates.value.filter((category) => category !== 'past');
  blinkIfAllHidden();
  await nextTick();
  filterButtonRef.value?.focus();
}

const INFO_MODAL_SUPPRESS_KEY = 'pcd-info-modal-suppressed';
const infoModalOpen = ref(false);
const infoModalAutoOpened = ref(false);
const submitModalOpen = ref(false);

function handleSubmitClick() {
  submitModalOpen.value = true;
  trackEvent(SUBMIT_EVENT_BUTTON_CLICK);
}

function handleInfoClick() {
  infoModalOpen.value = true;
  infoModalAutoOpened.value = false;
}

function shouldAutoOpenInfoModal(): boolean {
  return safeStorage.get(INFO_MODAL_SUPPRESS_KEY) !== 'true';
}

function suppressInfoModal() {
  safeStorage.set(INFO_MODAL_SUPPRESS_KEY, 'true');
  infoModalOpen.value = false;
}

function preloadBannerImage() {
  const url = props.bannerImageUrl;
  if (url) new Image().src = url;
}

let mapInstance: import('leaflet').Map | null = null;
let leafletRef: typeof import('leaflet') | null = null;
let clusterGroup: import('leaflet').LayerGroup | null = null;
const markerMap = new Map<string, import('leaflet').Marker>();
const nodeMap = new Map<string, Node>(); // id → Node, for O(1) lookups
let openPopupNodeId: string | null = null;
let slidingWindowHandler: ((e: FocusEvent) => void) | null = null;
let pendingPopupMarker: import('leaflet').Marker | null = null;
let teardownMarkerPopupListeners: (() => void) | null = null;
let teardownPopupActivities: (() => void) | null = null;

// --- Tile layer config ---
interface TileLayerConfig { url: string; options: Record<string, unknown>; }

const CARTO_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const LIGHT_LAYERS: TileLayerConfig[] = [
  {
    url: cartoTileUrl('light_nolabels'),
    options: { attribution: CARTO_ATTR, subdomains: 'abcd', maxZoom: 20, detectRetina: true },
  },
  {
    url: cartoTileUrl('light_only_labels'),
    options: { attribution: CARTO_ATTR, subdomains: 'abcd', maxZoom: 20, detectRetina: true, tileSize: 512, zoomOffset: -1 },
  },
];

const SLIDING_WINDOW_MARGIN = 0.28; // 28% dead zone inset from each edge

function setMapStyle(map: import('leaflet').Map, L: typeof import('leaflet')) {
  LIGHT_LAYERS.forEach(cfg => {
    L.tileLayer(cfg.url, cfg.options).addTo(map);
  });
}

function setActiveMarker(nodeId: string | null) {
  markerMap.forEach((marker, id) => {
    marker.getElement()?.classList.toggle('marker-active', id === nodeId);
  });
}

const PANEL_BREAKPOINT = 720; // matches NodePanel.vue @media (max-width: 720px)

function getPanelWidth(): number {
  if (window.innerWidth <= PANEL_BREAKPOINT) return 0; // full-width on mobile
  return Math.min(Math.max(window.innerWidth * 0.4, 320), 520); // clamp(320px, 40vw, 520px)
}

function focusNode(node: Node, { animate = false, zoom = 5 }: { animate?: boolean; zoom?: number } = {}) {
  if (!mapInstance) return;
  selectedNode.value = null;
  const map = mapInstance;
  const panelWidth = getPanelWidth();

  const onSettle = () => {
    if (panelWidth > 0) {
      map.panBy([panelWidth / 2, 0], { animate: false });
    }
    openPanel(node);
  };

  if (animate) {
    map.once('moveend', onSettle);
    map.flyTo([node.lat, node.lng], zoom, { duration: 1 });
  } else {
    map.setView([node.lat, node.lng], zoom);
    onSettle();
  }
}

function openPanel(node: Node) {
  closeFilterPanel({ refocus: false });
  selectedNode.value = node;
  const marker = markerMap.get(node.id);
  marker?.closePopup();
  setActiveMarker(node.id);
}

function closePanel() {
  selectedNode.value = null;
  setActiveMarker(null);
}

function panToKeepInView(lat: number, lng: number): void {
  if (!mapInstance) return;
  if (selectedNode.value !== null) return;
  if (openPopupNodeId !== null) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const containerPoint = mapInstance.latLngToContainerPoint([lat, lng]);
  const size = mapInstance.getSize();

  const mx = size.x * SLIDING_WINDOW_MARGIN;
  const my = size.y * SLIDING_WINDOW_MARGIN;

  let dx = 0;
  let dy = 0;

  if (containerPoint.x < mx)               dx = containerPoint.x - mx;
  else if (containerPoint.x > size.x - mx) dx = containerPoint.x - (size.x - mx);

  if (containerPoint.y < my)               dy = containerPoint.y - my;
  else if (containerPoint.y > size.y - my) dy = containerPoint.y - (size.y - my);

  if (dx !== 0 || dy !== 0) {
    mapInstance.panBy([dx, dy], {
      animate: !reduceMotion,
      duration: reduceMotion ? 0 : 0.3,
    });
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (infoModalOpen.value || submitModalOpen.value) return;

  const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase();
  const isTextInput = tag === 'input' || tag === 'textarea' ||
    (document.activeElement as HTMLElement)?.isContentEditable ||
    !!(document.activeElement as HTMLElement)?.closest?.('header[data-site-header]');

  if (e.key === 'Escape') {
    if (filterPanelOpen.value) {
      e.preventDefault();
      closeFilterPanel();
    } else if (selectedNode.value) {
      closePanel();
    } else if (openPopupNodeId && mapInstance) {
      e.stopPropagation(); // prevent Leaflet from also handling this Escape
      const marker = markerMap.get(openPopupNodeId);
      mapInstance.closePopup();
      marker?.getElement()?.focus();
    } else {
      const mapEl = document.getElementById('map');
      if (mapEl && mapEl.contains(document.activeElement) && document.activeElement !== mapEl) {
        e.preventDefault();
        mapEl.focus();
      }
    }
    return;
  }

  if (isTextInput) return;

  if (/^[0-9]$/.test(e.key)) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === '0') {
      mapInstance?.setView([20, 10], 3);
    } else {
      mapInstance?.setZoom(parseInt(e.key));
    }
  } else if (e.key === '+' || e.key === '=' || e.key === 'Add') {
    e.preventDefault();
    e.stopPropagation();
    mapInstance?.zoomIn();
  } else if (e.key === '-' || e.key === 'Subtract') {
    e.preventDefault();
    e.stopPropagation();
    mapInstance?.zoomOut();
  } else if (e.key === 'L' || e.key === 'l') {
    e.preventDefault();
    document.getElementById('map')?.focus();
  }
}

onMounted(async () => {
  const L = (await import('leaflet')).default;
  await import('leaflet.markercluster');
  await import('@luomus/leaflet-smooth-wheel-zoom');

  const map = L.map('map', {
    zoomControl: false,
    scrollWheelZoom: false,
    smoothWheelZoom: true,
    smoothSensitivity: 1,
    minZoom: 1,
  });
  mapInstance = map;
  leafletRef = L;

  // Remove digit (48–57) and +/- keyCodes from Leaflet's built-in zoom handler
  // so our global shortcuts don't double-fire when the map is focused.
  const kb = (map as any).keyboard;
  if (kb?._zoomKeys) {
    for (let code = 48; code <= 57; code++) delete kb._zoomKeys[code];
    // +/= (187, 61) and -/_ (189, 173) — Leaflet's default zoom-in/out keys
    for (const code of [61, 173, 187, 189]) delete kb._zoomKeys[code];
  }

  L.control.zoom({ position: 'bottomleft' }).addTo(map);

  // Manage tab order for Leaflet-injected elements:
  // - Zoom buttons stay in tab order (they are our primary map keyboard controls)
  // - Attribution links stay in tab order but move to end of DOM (after markers)
  // - All other Leaflet controls are removed from tab order
  requestAnimationFrame(() => {
    document.querySelectorAll('.leaflet-control a, .leaflet-control button').forEach(el => {
      const inZoom = el.closest('.leaflet-control-zoom');
      const inAttribution = el.closest('.leaflet-control-attribution');
      if (!inZoom && !inAttribution) {
        el.setAttribute('tabindex', '-1');
      }
    });
    // Leaflet sets tabindex="0" on the map container — force it back to -1
    // so tab order flows through our own controls instead
    map.getContainer().setAttribute('tabindex', '-1');

    const mapContainer = map.getContainer();
    const controlContainer = mapContainer.querySelector('.leaflet-control-container');
    const mapPane = mapContainer.querySelector('.leaflet-map-pane');

    // Move zoom controls before the marker pane so screen readers and tab order
    // encounter zoom buttons before individual markers
    if (controlContainer && mapPane) {
      mapContainer.insertBefore(controlContainer, mapPane);
    }

    // Move attribution control to the very end of the map container so it
    // appears last in tab order (after all markers)
    const attribution = mapContainer.querySelector('.leaflet-control-attribution')?.closest('.leaflet-bottom');
    if (attribution) {
      mapContainer.appendChild(attribution);
    }

  });

  // Deep links focus the event; otherwise start at the default world view.
  const eventId = props.initialEventId ?? new URLSearchParams(window.location.search).get('event');
  const linkedNode = eventId ? props.nodes.find((n) => n.id === eventId || n.uid === eventId) : null;

  if (!linkedNode) {
    map.setView([20, 10], 3);
  }

  setMapStyle(map, L);

  const pastMarkers = new WeakSet<import('leaflet').Marker>();

  // Cluster group with Google Maps-style concentric circles
  clusterGroup = (L as unknown as { markerClusterGroup: (opts?: object) => import('leaflet').LayerGroup }).markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 40,
    disableClusteringAtZoom: 4,
    iconCreateFunction: (cluster: { getChildCount: () => number; getAllChildMarkers: () => import('leaflet').Marker[] }) => {
      const count = cluster.getChildCount();
      const allPast = cluster.getAllChildMarkers().every((marker) => pastMarkers.has(marker));
      const color = allPast ? 'var(--color-event-past)' : 'var(--color-event-confirmed)';
      const r1 = 24, r2 = 18, r3 = 12;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${r1 * 2}" height="${r1 * 2}" viewBox="0 0 ${r1 * 2} ${r1 * 2}">
        <circle cx="${r1}" cy="${r1}" r="${r1}" fill="${color}" opacity="0.2"/>
        <circle cx="${r1}" cy="${r1}" r="${r2}" fill="${color}" opacity="0.3"/>
        <circle cx="${r1}" cy="${r1}" r="${r3}" fill="${color}" opacity="0.9"/>
        <text x="${r1}" y="${r1}" text-anchor="middle" dominant-baseline="central"
          font-family="IBM Plex Sans, system-ui, sans-serif" font-size="11" font-weight="600" fill="#fff">${count}</text>
      </svg>`;
      return L.divIcon({
        html: svg,
        className: 'marker-cluster-custom',
        iconSize: [r1 * 2, r1 * 2],
        iconAnchor: [r1, r1],
      });
    },
  });

  const calendarSymbol = `<g class="marker-symbol marker-symbol--calendar" color="#fff" transform="translate(6 6) scale(0.875)">${calendarIcon}</g>`;
  // The circle-free Octicon occupies the middle of its original 16px viewBox.
  const questionSymbol = `<g class="marker-symbol marker-symbol--question" color="#fff" transform="scale(1.625)">${questionMarkIcon}</g>`;

  // Add markers. Color describes the date state; the symbol signals whether
  // the event's date and location are confirmed, including online events.
  props.nodes.forEach((node) => {
    nodeMap.set(node.id, node);
    const past = isPastEvent(node);
    const confirmed = !!node.event_date && !node.location_tbd && !node.placeholder;
    const hasDate = Number(!!node.event_date);
    const hasLocation = Number(!node.location_tbd);
    const hasTime = Number(!!node.event_start_time);
    // More known fields win; equal counts prefer date, then location, then time.
    const informationPriority = (hasDate + hasLocation + hasTime) * 8
      + hasDate * 4 + hasLocation * 2 + hasTime;
    const stateClass = !node.event_date
      ? (node.location_tbd ? ' marker-node--date-location-tbd' : ' marker-node--undated')
      : past ? ' marker-node--past' : '';
    const icon = L.divIcon({
      className: `marker-node${stateClass}${node.online_event ? ' marker-node--online' : ''}`,
      html: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        <circle class="marker-shape" cx="13" cy="13" r="12" fill="var(--color-event-confirmed)" stroke="#fff" stroke-width="2" />
        ${confirmed ? calendarSymbol : past ? '' : questionSymbol}
      </svg>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      popupAnchor: [0, -15],
    });
    const marker = L.marker([node.lat, node.lng], {
      icon,
      // Non-past events lead; 32 exceeds the maximum information score (31).
      // Separate overlapping dots' priority tiers beyond Leaflet's latitude offset.
      zIndexOffset: ((past ? 0 : 32) + informationPriority) * 1000,
    });
    if (past) pastMarkers.add(marker);
    marker.bindPopup(() => makePopupContent(node), {
      maxWidth: 340,
      autoPanPaddingTopLeft: L.point(16, 80),
      autoPanPaddingBottomRight: L.point(16, 24),
    });
    markerMap.set(node.id, marker);
    clusterGroup.addLayer(marker);
  });

  map.addLayer(clusterGroup);

  // Removing hidden markers from the group also updates cluster counts and
  // keeps them out of the keyboard navigation order.
  watch(filteredNodes, (visibleNodes) => {
    if (!clusterGroup) return;
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    markerMap.forEach((marker, id) => {
      const isVisible = clusterGroup!.hasLayer(marker);
      if (visibleIds.has(id) && !isVisible) clusterGroup!.addLayer(marker);
      if (!visibleIds.has(id) && isVisible) clusterGroup!.removeLayer(marker);
    });
    if (selectedNode.value && !visibleIds.has(selectedNode.value.id)) closePanel();
    syncMarkerDOM();
  });

  // Apply accessible names to marker elements. Leaflet creates marker DOM elements
  // lazily, so we apply after layer is added and re-apply whenever the cluster
  // animates (which shows/hides individual markers as clusters form or dissolve).
  function applyMarkerLabels() {
    markerMap.forEach((marker, id) => {
      const node = nodeMap.get(id);
      const el = marker.getElement();
      if (node && el) {
        el.setAttribute('aria-label', node.event_name);
        el.dataset.nodeId = id;
      }
    });
  }

  // Sort the marker pane so cluster markers appear before individual markers
  // in the DOM, giving screen readers a logical order: clusters first, then nodes.
  function sortMarkerPane() {
    const pane = map.getPanes().markerPane;
    if (!pane) return;
    const clusters = Array.from(pane.querySelectorAll<HTMLElement>('.marker-cluster-custom'));
    const markers = Array.from(pane.querySelectorAll<HTMLElement>('.marker-node'));
    clusters.forEach(el => pane.appendChild(el));
    markers.forEach(el => pane.appendChild(el));
    clusters.forEach(el => pane.insertBefore(el, pane.firstChild));
  }

  // Sync all marker DOM state: accessible labels, pane order, and active highlight.
  // Called on initial marker paint and after any cluster animation that rebuilds elements.
  function syncMarkerDOM() {
    applyMarkerLabels();
    sortMarkerPane();
    setActiveMarker(selectedNode.value?.id ?? null);
  }

  // Watch the marker pane for DOM changes on initial load — marker elements are
  // created lazily by the cluster group after the first setView, so we can't
  // rely on a fixed timeout. Disconnect after the first batch of markers appear.
  const markerPane = map.getPanes().markerPane;
  if (markerPane) {
    const observer = new MutationObserver(() => {
      syncMarkerDOM();
      observer.disconnect();
    });
    observer.observe(markerPane, { childList: true, subtree: false });
  }

  // Deep link: open the panel for the linked event. Deferred to here so that:
  // (1) markerMap is fully populated, and (2) the MutationObserver above is
  // already watching — focusNode calls setView which triggers Leaflet's lazy
  // marker DOM creation, and the observer fires syncMarkerDOM() to apply the
  // active highlight once elements exist.
  if (linkedNode) {
    focusNode(linkedNode);
  }

  clusterGroup.on('animationend', () => { syncMarkerDOM(); });

  // When a cluster spiderfies, move its child marker elements immediately after
  // the cluster's own element in the DOM so screen readers encounter them next.
  clusterGroup.on('spiderfied', (e: { cluster: import('leaflet').Layer; markers: import('leaflet').Marker[] }) => {
    applyMarkerLabels();
    const pane = map.getPanes().markerPane;
    if (!pane) return;
    const clusterEl = (e.cluster as import('leaflet').Marker).getElement?.();
    if (!clusterEl) return;
    // Insert each child element right after the cluster element
    let insertAfter: Element = clusterEl;
    e.markers.forEach((m) => {
      const el = m.getElement?.();
      if (el && el !== insertAfter) {
        insertAfter.after(el);
        insertAfter = el;
      }
    });
    // Move focus to the first child marker so Tab continues from there
    const firstChildEl = e.markers[0]?.getElement?.();
    firstChildEl?.focus();
    setActiveMarker(selectedNode.value?.id ?? null);
  });

  // Sliding window: pan just enough to keep focused markers in the safe zone
  slidingWindowHandler = (e: FocusEvent) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('marker-node')) return;

    let foundNode: Node | undefined;
    for (const [id, marker] of markerMap) {
      if (marker.getElement() === target) {
        foundNode = nodeMap.get(id);
        break;
      }
    }

    if (foundNode) {
      const lat = foundNode.lat;
      const lng = foundNode.lng;
      // Defer past Leaflet's own focus/keyboard handlers that may pan synchronously
      requestAnimationFrame(() => panToKeepInView(lat, lng));
    }
  };
  map.getContainer().addEventListener('focusin', slidingWindowHandler);

  // Open popup on the first pointerdown even when the map doesn't have focus.
  // Browsers normally require a first click to focus the page, and a second to
  // trigger Leaflet's click handler. By calling openPopup() on pointerdown we
  // bypass that two-click requirement.
  //
  // State management: pendingPopupMarker is set on pointerdown (when we open the
  // popup ourselves) and consumed by the capture-phase click handler, which calls
  // stopImmediatePropagation() to prevent Leaflet's _handleDOMEvent from toggling
  // the popup closed again. Two reset paths handle the case where no click follows:
  //   1. pointercancel — browser aborted the gesture (scroll, system dialog, etc.)
  //   2. document pointerup — pointer released anywhere on the document.
  //      - Released inside the pane: a click will follow in the same task, so we
  //        defer the clear via setTimeout(0) (a macrotask) to let onMarkerClick
  //        consume the flag first. Microtasks (Promise.resolve) run before the
  //        next event and would incorrectly race ahead of the click.
  //      - Released outside the pane: no click follows, so clear immediately.
  //
  // Pointer capture: we call setPointerCapture on the actual event target (the SVG
  // or circle child, not the .marker-node ancestor) because the spec requires the
  // element that received the pointerdown. This improves pointercancel delivery
  // when the pointer leaves the element, though capture may still fail on some
  // SVG internals — the document pointerup path covers that fallback.

  const onMarkerPointerdown = (e: PointerEvent) => {
    const target = e.target as HTMLElement;
    const markerEl = target.closest('.marker-node') as HTMLElement | null;
    if (!markerEl) return;
    // O(1) lookup via data-nodeId set in applyMarkerLabels()
    const marker = markerMap.get(markerEl.dataset.nodeId ?? '');
    if (!marker) return;
    if (!marker.isPopupOpen()) {
      marker.openPopup();
      pendingPopupMarker = marker;
      // Request pointer capture on the real event target so that pointercancel
      // is delivered here even after the pointer leaves the element.
      try { target.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    }
  };

  const onMarkerClick = (e: MouseEvent) => {
    if (pendingPopupMarker) {
      // Stop all further listeners and prevent the event reaching the bubble phase.
      // This blocks Leaflet's _handleDOMEvent from toggling the popup closed.
      e.stopImmediatePropagation();
      pendingPopupMarker = null;
    }
  };

  const clearPendingOnPointerup = (e: PointerEvent) => {
    // Pointer was released somewhere on the document. Two cases:
    //
    // a) Release inside the markerPane: a click event follows in the next task.
    //    setTimeout(..., 0) schedules a macrotask that runs after the click task
    //    completes, so onMarkerClick gets to consume and clear the flag first.
    //    (A microtask would run before the click event and clear the flag too early.)
    //
    // b) Release outside the markerPane: no click will follow, so clear
    //    immediately without deferring.
    const insidePane = markerPane?.contains(e.target as globalThis.Node) ?? false;
    if (insidePane) {
      setTimeout(() => { pendingPopupMarker = null; }, 0);
    } else {
      pendingPopupMarker = null;
    }
  };

  const onMarkerPointercancel = () => {
    // Browser aborted the gesture (scroll, system interrupt). No click follows.
    pendingPopupMarker = null;
  };

  const onPopupClose = () => {
    teardownPopupActivities?.();
    teardownPopupActivities = null;
    openPopupNodeId = null;
  };

  markerPane?.addEventListener('pointerdown', onMarkerPointerdown, { capture: true });
  markerPane?.addEventListener('click', onMarkerClick, { capture: true });
  markerPane?.addEventListener('pointercancel', onMarkerPointercancel, { capture: true });
  document.addEventListener('pointerup', clearPendingOnPointerup);
  map.on('popupclose', onPopupClose);

  teardownMarkerPopupListeners = () => {
    markerPane?.removeEventListener('pointerdown', onMarkerPointerdown, { capture: true });
    markerPane?.removeEventListener('click', onMarkerClick, { capture: true });
    markerPane?.removeEventListener('pointercancel', onMarkerPointercancel, { capture: true });
    document.removeEventListener('pointerup', clearPendingOnPointerup);
    map.off('popupclose', onPopupClose);
  };

  // Move focus into popup content when it opens
  map.on('popupopen', (e) => {
    const container = e.popup.getElement();
    if (!container) return;
    teardownPopupActivities?.();
    teardownPopupActivities = fitPopupActivities(container);
    // Track which node's popup is open
    const btn = container.querySelector<HTMLElement>('.read-more');
    openPopupNodeId = btn?.getAttribute('data-node-id') ?? null;
    const focusTarget = container.querySelector<HTMLElement>('button, a, [tabindex]');
    focusTarget?.focus({ preventScroll: true });
  });

  // Delegated clicks for popup actions
  const mapEl = document.getElementById('map');
  if (mapEl) {
    mapEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-hide-past-events]')) {
        hidePastEvents();
        return;
      }
      if (target.closest('a')) return; // let icon links open without triggering panel
      const btn = target.closest('.read-more');
      if (btn) {
        const nodeId = btn.getAttribute('data-node-id');
        if (nodeId) {
          const node = props.nodes.find((n) => n.id === nodeId);
          if (node) openPanel(node);
        }
      }
    });
  }

  // Global keyboard shortcuts
  document.addEventListener('keydown', handleKeydown);


  // Auto-open info modal on first visit, unless arriving via a direct event link
  if (shouldAutoOpenInfoModal() && !linkedNode) {
    infoModalOpen.value = true;
    infoModalAutoOpened.value = true;
  }

  // Update document-level text when locale changes
  watch(currentLocale, () => {
    document.title = i18n.global.t('page.title');
    document.querySelector('meta[name="description"]')?.setAttribute('content', i18n.global.t('page.description'));
    const skipLink = document.getElementById('skip-link');
    if (skipLink) skipLink.textContent = i18n.global.t('page.skip_to_map');
  }, { immediate: true });
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  if (slidingWindowHandler && mapInstance) {
    mapInstance.getContainer().removeEventListener('focusin', slidingWindowHandler);
    slidingWindowHandler = null;
  }
  teardownMarkerPopupListeners?.();
  teardownPopupActivities?.();
  teardownMarkerPopupListeners = null;
  mapInstance?.remove();
});
</script>

<template>
  <div class="map-chrome" :class="{ 'map-chrome--filters-open': filterPanelOpen }">
    <div v-show="!filterPanelOpen" class="banner-controls-left">
      <button
        ref="filterButtonRef"
        class="map-filter-button"
        type="button"
        :class="{ 'map-filter-button--active': activeFilterCount > 0 }"
        :aria-expanded="filterPanelOpen"
        aria-controls="map-filter-panel"
        @click="toggleFilterPanel"
      >
        <Icon icon="bi:filter" width="1em" height="1em" aria-hidden="true" />
        <span>{{ t('filters.button') }}</span>
        <span v-if="activeFilterCount" class="filter-count" aria-hidden="true">{{ activeFilterCount }}</span>
      </button>
      <LanguageSwitcher />
    </div>
    <div class="host-btn-group">
      <button id="host-btn" @click="handleSubmitClick()">{{ t('nav.submit_event') }}</button>
      <button
        id="info-btn"
        :aria-label="t('nav.info_button_label')"
        @mouseenter="preloadBannerImage"
        @click="handleInfoClick()"
      >i</button>
    </div>
    <InfoModal :open="infoModalOpen" :bannerImageUrl="props.bannerImageUrl" :autoOpened="infoModalAutoOpened" @close="infoModalOpen = false" @suppress="suppressInfoModal" />
    <SubmitModal :open="submitModalOpen" @close="submitModalOpen = false" />
  </div>
  <Transition name="filter-panel">
  <aside
    v-show="filterPanelOpen"
    id="map-filter-panel"
    class="map-filter-panel"
    :inert="!filterPanelOpen"
    :aria-label="t('filters.title')"
  >
    <button ref="filterCloseRef" type="button" class="filter-panel-tab" :class="{ 'close-direction-hint': filterPanelOpen && !filterCloseLearned }" :aria-label="t('filters.close')" @click="handleFilterTabClick()">
      <Icon icon="bi:chevron-left" width="1em" height="1em" aria-hidden="true" />
    </button>
    <div class="filter-panel-mobile-back">
      <button ref="filterBackRef" type="button" class="filter-back-button" @click="closeFilterPanel()">
        {{ t('panel.back_to_map') }}
        <Icon icon="bi:arrow-right" width="1em" height="1em" aria-hidden="true" />
      </button>
    </div>
    <div class="filter-panel-scroll">
    <div class="filter-panel-header">
      <h2>{{ t('filters.title') }}</h2>
      <p :class="{ 'filter-no-matches': filteredNodes.length === 0 }" role="status">{{ filteredNodes.length === 0 ? t('filters.no_matches') : t('filters.showing', { shown: filteredNodes.length, total: props.nodes.length }) }}</p>
    </div>

    <fieldset>
      <legend class="date-filter-heading">
        <span class="date-filter-desktop-title">{{ t('filters.when') }}</span>
        <span class="date-filter-mobile-title">{{ t('filters.title') }}</span>
        <span class="date-visibility-actions">
          <button type="button" class="show-all-dates" :disabled="visibleDates.length === dateCategories.length" @click="showAllDates">{{ t('filters.show_all') }}</button>
        </span>
      </legend>
      <div class="filter-options date-visibility-options">
        <button
          v-for="category in dateCategories"
          :key="category"
          type="button"
          class="date-visibility-toggle"
          :class="{ 'date-visibility-toggle--hover-suppressed': suppressedDateHover === category }"
          @mouseleave="suppressedDateHover = null"
          :data-date-category="category"
          :aria-pressed="visibleDates.includes(category)"
          @click="toggleDateVisibility(category)"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <g
              class="date-eye"
              :class="{
                'date-eye--dilated': blinking && lastHiddenDate === category && visibleDates.includes(category),
                'date-eye--readjusting': readjustingEye === category,
              }"
              @animationend.self="readjustingEye = null"
            >
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
              <circle class="date-eye-pupil" cx="12" cy="12" r="3" />
            </g>
            <path v-if="!visibleDates.includes(category)" d="m3 3 18 18" />
          </svg>
          {{ t(`filters.${category}`) }}
        </button>
      </div>
    </fieldset>

    <fieldset>
      <legend>{{ t('filters.format') }}</legend>
      <div class="filter-options">
        <label><input v-model="selectedFormats" type="checkbox" value="in-person" /> {{ t('filters.in_person') }}</label>
        <label><input v-model="selectedFormats" type="checkbox" value="online" /> {{ t('filters.online') }}</label>
      </div>
    </fieldset>

    <fieldset>
      <legend>{{ t('filters.event_types') }}</legend>
      <div class="filter-options">
        <label v-for="activity in activityOptions" :key="activity">
          <input v-model="selectedActivities" type="checkbox" :value="activity" /> {{ activity }}
        </label>
      </div>
    </fieldset>

    </div>
    <div class="filter-panel-footer">
    <p class="filter-panel-mobile-count" :class="{ 'filter-no-matches': filteredNodes.length === 0 }" role="status">{{ filteredNodes.length === 0 ? t('filters.no_matches') : t('filters.showing_compact', { shown: filteredNodes.length, total: props.nodes.length }) }}</p>
    <button type="button" class="clear-filters" :disabled="activeFilterCount === 0" @click="clearFilters">
      {{ t('filters.clear') }}
    </button>
    </div>
  </aside>
  </Transition>
  <NodePanel :node="selectedNode" @close="closePanel" @hide-past-events="hidePastEvents" />
  <div id="map" tabindex="-1" :aria-label="t('map.aria_label')"></div>
  <EyelidBlink v-if="blinking" @reopen="restoreLastHiddenDate" @complete="finishBlink" />
</template>

<style scoped>
.date-eye,
.date-eye-pupil {
  transform-origin: 12px 12px;
}

.date-eye--readjusting {
  animation: eye-readjust 700ms ease-in-out 180ms both;
}

.date-eye--readjusting .date-eye-pupil {
  animation: pupil-readjust 700ms ease-out 180ms both;
}

@media (prefers-reduced-motion: no-preference) {
  .date-eye--dilated .date-eye-pupil {
    r: 1.9375px;
    stroke-width: 3.875px;
    transform: scale(1.35);
  }
}

@keyframes eye-readjust {
  0%, 12%, 42%, 100% { transform: scaleY(1); }
  25% { transform: scaleY(0.08); }
  58% { transform: scaleY(0.35); }
  76% { transform: scaleY(1); }
}

@keyframes pupil-readjust {
  /* Reduce the radius as the stroke thickens to fill inward, keeping
     the outer edge at 3.875px before the dilation scale is applied. */
  0%, 12% {
    r: 1.9375px;
    stroke-width: 3.875px;
    transform: scale(1.35);
  }
  70%, 100% {
    r: 3px;
    stroke-width: 1.75px;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .date-eye--readjusting,
  .date-eye--readjusting .date-eye-pupil {
    animation: none;
  }
}

#map {
  position: fixed;
  top: var(--header-height);
  left: 0;
  width: 100vw;
  height: calc(100vh - var(--header-height));
  z-index: 0;
}

.banner-controls-left {
  position: fixed;
  top: calc(var(--header-height) + var(--spacing-md));
  left: var(--spacing-md);
  z-index: var(--z-controls);
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.map-filter-button {
  display: flex;
  align-items: center;
  gap: 0.3em;
  height: 40px;
  padding: 0 0.625rem;
  background: var(--color-bg-popup);
  border: 2px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-text);
  font-family: var(--font-family);
  font-size: 0.8125rem;
  font-weight: 600;
  box-shadow: 0 10px 28px rgba(18, 19, 33, 0.18);
  backdrop-filter: blur(14px);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.map-filter-button:hover,
.map-filter-button--active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

.map-filter-button:focus-visible,
.clear-filters:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.filter-count {
  display: grid;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.25rem;
  border-radius: 999px;
  background: currentColor;
  color: var(--color-primary);
  font-size: 0.6875rem;
  place-items: center;
}

.map-filter-button--active .filter-count,
.map-filter-button:hover .filter-count {
  background: #fff;
}

.map-filter-panel {
  position: fixed;
  z-index: calc(var(--z-controls) - 1);
  top: var(--header-height);
  bottom: 0;
  left: 0;
  width: min(360px, calc(100vw - 40px));
  display: flex;
  flex-direction: column;
  background: var(--color-bg-panel);
  overscroll-behavior: none;
  filter: drop-shadow(4px 0 16px rgba(0, 0, 0, 0.18));
}

/* Extend behind the viewport edge without changing the panel's layout. */
.map-filter-panel::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  right: calc(100% - 1px);
  width: 33px;
  background: var(--color-bg-panel);
  pointer-events: none;
}

.filter-panel-scroll {
  flex: 1;
  min-height: 0;
  overscroll-behavior-y: contain;
  padding: var(--spacing-lg) var(--spacing-lg) 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: var(--color-bg-panel);
  border-right: 1px solid var(--color-border);
  position: relative;
  z-index: 1;
}

.filter-panel-enter-active {
  transition: var(--transition-panel-open);
}

.filter-panel-leave-active {
  transition: var(--transition-panel);
}

.filter-panel-enter-from,
.filter-panel-leave-to {
  transform: translateX(calc(-100% - 40px));
}

@media (prefers-reduced-motion: reduce) {
  .filter-panel-enter-active,
  .filter-panel-leave-active {
    transition: none;
  }
}

.filter-panel-header {
  flex-shrink: 0;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--spacing-md);
  margin-inline: calc(-1 * var(--spacing-lg));
  padding: 0 var(--spacing-lg) var(--spacing-md);
  border-bottom: 1px solid var(--color-border);
}

.filter-panel-header h2 {
  margin: 0;
  font-size: 1.375rem;
}

.filter-panel-header p {
  margin: 0;
  text-align: right;
  color: var(--color-text-muted);
  font-size: 0.8125rem;
}

.filter-panel-tab {
  --tab-r: 12px;
  position: absolute;
  right: 1px;
  top: 50%;
  transform: translate(100%, -50%) scaleX(-1);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 96px;
  background: var(--color-bg-popup);
  border: none;
  cursor: pointer;
  color: var(--color-primary);
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
    right: 4px;
    border: 1px solid var(--color-border);
    border-right: none;
    border-radius: 12px 0 0 12px;
    clip-path: none;
  }
}

.filter-panel-tab:hover {
  background: var(--color-bg-popup-hover);
}

.filter-panel-tab :deep(svg) {
  stroke: currentColor;
  stroke-width: 0.75;
  stroke-linejoin: round;
}

.filter-panel-tab:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

/* Mirror the tab shape without reversing the left-pointing arrow. */
.filter-panel-tab :deep(svg) {
  transform: scaleX(-1);
}

.map-filter-panel fieldset {
  flex-shrink: 0;
  margin: 0 calc(-1 * var(--spacing-lg));
  min-width: 0;
  padding: 1rem var(--spacing-lg) 1.25rem;
  border: 0;
  border-bottom: 1px solid var(--color-border);
}

.map-filter-panel legend {
  float: left;
  width: 100%;
  padding: 0;
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.25;
}

.filter-options {
  clear: both;
  display: grid;
  gap: 0.75rem;
  padding-top: 0.75rem;
}

.date-filter-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.show-all-dates {
  padding: 0.25rem 0;
  border: 0;
  background: none;
  color: var(--color-primary);
  font: 500 0.8125rem/1.4 var(--font-family);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.date-visibility-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.25rem 0.75rem;
}

.show-all-dates:disabled {
  color: #999;
  text-decoration: none;
  cursor: default;
}

.date-visibility-options {
  gap: 0.375rem;
}

.date-visibility-toggle {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  min-height: 44px;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
  font: 500 0.875rem/1.35 var(--font-family);
  text-align: left;
  cursor: pointer;
}

.date-visibility-toggle svg {
  flex: 0 0 auto;
}

.date-visibility-toggle[aria-pressed="true"] {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 7%, white);
  color: var(--color-primary);
}

.date-visibility-toggle[aria-pressed="true"]:not(.date-visibility-toggle--hover-suppressed):hover {
  background: color-mix(in srgb, var(--color-primary) 11%, white);
}

.date-visibility-toggle[aria-pressed="false"]:not(.date-visibility-toggle--hover-suppressed):hover {
  background: #e8f0fe;
  border-color: #a9c5ee;
}

.map-filter-panel label {
  position: relative;
  isolation: isolate;
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  color: var(--color-text);
  font-size: 0.875rem;
  line-height: 1.35;
  cursor: pointer;
}

.map-filter-panel label::before {
  content: "";
  position: absolute;
  inset: -0.375rem -0.75rem;
  z-index: -1;
  border-radius: 6px;
  pointer-events: none;
}

.map-filter-panel label:hover::before {
  background: #e8f0fe;
}

.map-filter-panel input {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--color-primary);
}

.filter-panel-footer {
  position: relative;
  z-index: 2;
  flex-shrink: 0;
  padding: var(--spacing-md) var(--spacing-lg);
  padding-bottom: max(var(--spacing-md), env(safe-area-inset-bottom));
  touch-action: none;
  background: var(--color-bg-panel);
  border-top: 1px solid var(--color-border);
  box-shadow: 0 -8px 20px rgb(18 19 33 / 8%);
}

.clear-filters {
  width: 100%;
  padding: 0.625rem 1rem;
  border: 2px solid var(--color-primary);
  border-radius: 6px;
  background: var(--color-primary);
  color: #fff;
  font: 600 0.875rem/1.3 var(--font-family);
  cursor: pointer;
}

.clear-filters:hover:not(:disabled) {
  background: var(--color-primary-dark);
  border-color: var(--color-primary-dark);
  color: #fff;
}

.clear-filters:disabled {
  opacity: 0.45;
  cursor: default;
}

.map-filter-panel .filter-no-matches {
  color: var(--color-primary);
  font-weight: 700;
  font-size: 1rem;
}

.filter-panel-mobile-back,
.filter-panel-mobile-count,
.date-filter-mobile-title {
  display: none;
}

@media (max-width: 640px) {
  .map-filter-panel {
    width: 100%;
  }

  .filter-panel-tab,
  .filter-panel-header,
  .date-filter-desktop-title {
    display: none;
  }

  .date-filter-mobile-title {
    display: block;
    font-size: 1.375rem;
  }

  .filter-panel-mobile-back {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
    height: var(--header-height);
    padding: 0 var(--spacing-lg);
    position: relative;
    z-index: 2;
    background: var(--color-bg-panel);
    border-bottom: 1px solid var(--color-border);
    box-shadow: 0 4px 12px rgb(18 19 33 / 8%);
    touch-action: none;
  }

  .filter-back-button {
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

  .filter-back-button:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  .filter-panel-scroll {
    border-right: none;
  }

  .filter-panel-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-md);
  }

  .filter-panel-mobile-count {
    display: block;
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.875rem;
  }

  .clear-filters {
    width: auto;
    min-height: 44px;
  }

  .map-chrome--filters-open .host-btn-group {
    z-index: calc(var(--z-controls) - 2);
  }
}

@media (max-width: 600px) {
  .banner-controls-left {
    top: calc(var(--header-height) + var(--spacing-sm));
    left: var(--spacing-sm);
    gap: 0.375rem;
  }

  .map-chrome--filters-open .host-btn-group {
    z-index: calc(var(--z-controls) - 2);
  }
}
</style>

<style>
.marker-node > svg {
  overflow: visible;
  filter: drop-shadow(0 2px 3px rgb(0 0 0 / 30%));
}

.marker-node--past .marker-shape {
  fill: var(--color-event-past);
}

.marker-node--undated .marker-shape {
  fill: var(--color-event-undated);
}

.marker-node--date-location-tbd .marker-shape {
  fill: var(--color-event-date-location-tbd);
}

.marker-node.marker-active > svg {
  overflow: visible;
  filter: drop-shadow(0 2px 3px rgb(0 0 0 / 30%)) drop-shadow(0 0 5px rgba(255, 255, 255, 0.95)) drop-shadow(0 0 10px color-mix(in srgb, var(--color-primary) 90%, transparent));
  transform: scale(1.4);
  transform-origin: center;
}

.marker-node.marker-active .marker-shape {
  stroke-width: 3.5;
}
</style>
