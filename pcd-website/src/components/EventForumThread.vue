<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { forumTopicId, forumTopicDetails } from '../lib/forum-topics.mjs';

const props = defineProps<{ url: string; stacked?: boolean }>();
const { t, locale } = useI18n();
const topic = ref<ReturnType<typeof forumTopicDetails> | null>(null);
const loading = ref(false);
const pending = ref(true);
const failed = ref(false);
const now = ref(Date.now());
let controller: AbortController | undefined;
let interval: ReturnType<typeof setInterval> | undefined;
const updatedLabel = computed(() => {
  if (!topic.value) return '';
  const seconds = Math.max(0, (now.value - Date.parse(topic.value.updated)) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' });
  for (const [unit, duration] of [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]] as const) {
    if (seconds >= duration) return formatter.format(-Math.floor(seconds / duration), unit);
  }
  return formatter.format(0, 'second');
});
const exactDate = computed(() => topic.value
  ? new Date(topic.value.updated).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' }) : '');

async function load() {
  const id = forumTopicId(props.url);
  if (!id) { failed.value = true; pending.value = false; return; }
  controller?.abort();
  controller = new AbortController();
  const request = controller;
  const delay = setTimeout(() => { loading.value = true; }, 150);
  const timeout = setTimeout(() => request.abort(), 10000);
  failed.value = false;
  pending.value = true;
  try {
    const response = await fetch(`/api/pcd-forum-topic/${id}`, { credentials: 'omit', signal: request.signal });
    if (!response.ok) throw new Error('Forum request failed');
    topic.value = forumTopicDetails(await response.json(), id);
  } catch {
    failed.value = true;
  } finally {
    clearTimeout(delay);
    clearTimeout(timeout);
    loading.value = false;
    pending.value = false;
  }
}
onMounted(() => {
  load();
  interval = setInterval(() => { now.value = Date.now(); }, 60000);
});
onUnmounted(() => { controller?.abort(); clearInterval(interval); });
function hideBrokenAvatar(event: Event) { (event.target as HTMLImageElement).hidden = true; }
</script>

<template>
  <div class="event-detail-forum" :class="{ 'event-detail-forum--stacked': stacked }">
    <slot />
    <div class="forum-metadata-slot" :aria-busy="pending">
    <div v-if="topic" class="forum-metadata">
      <div v-if="topic.posters.length" class="forum-avatars" role="group" :aria-label="t('panel.forum_participants')">
        <span v-for="poster in topic.posters" :key="poster.username" class="forum-avatar" role="img" :aria-label="poster.username" :title="poster.username">
          {{ poster.username.slice(0, 1).toUpperCase() }}
          <img v-if="poster.avatar" :src="poster.avatar" alt="" width="28" height="28" loading="lazy" @error="hideBrokenAvatar" />
        </span>
      </div>
      <span class="forum-replies" :title="t('panel.forum_replies', topic.replies)">{{ t('panel.forum_replies', topic.replies) }}</span>
      <time :datetime="topic.updated" :title="exactDate" :aria-label="exactDate">{{ updatedLabel }}</time>
    </div>
    <div v-else-if="pending" class="forum-metadata forum-skeleton" :class="{ 'forum-skeleton--visible': loading }" aria-hidden="true">
      <div class="forum-avatars">
        <span v-for="index in 2" :key="index" class="forum-avatar skeleton-bar"></span>
      </div>
      <span class="skeleton-bar skeleton-replies"></span>
      <span class="skeleton-bar skeleton-relative"></span>
    </div>
    <p v-else-if="failed" class="forum-status" role="status"><span class="forum-sr-only">{{ t('panel.forum_unavailable') }} </span><button type="button" @click="load">{{ t('panel.forum_retry') }}</button></p>
    </div>
    <p v-if="loading" class="forum-sr-only" role="status">{{ t('panel.forum_loading') }}</p>
  </div>
</template>

<style scoped>
.event-detail-forum { display: flex; align-items: center; flex-wrap: wrap; flex: 1; min-width: 0; column-gap: 16px; row-gap: 8px; }
.event-detail-forum--stacked { flex-direction: column; align-items: stretch; }
.event-detail-forum--stacked .forum-metadata { justify-content: center; }
.forum-metadata-slot { flex: 0 0 auto; width: 240px; max-width: 100%; height: 28px; }
.event-detail-forum--stacked .forum-metadata-slot { width: 100%; }
.forum-metadata { display: flex; align-items: center; flex-wrap: nowrap; gap: 6px; height: 100%; font-size: .75rem; color: var(--color-text-muted); }
.forum-avatars { display: flex; align-items: center; flex: 0 1 auto; min-width: 28px; overflow: hidden; }
.forum-avatar { position: relative; display: grid; place-items: center; flex: 0 0 28px; width: 28px; height: 28px; overflow: hidden; border: 2px solid white; border-radius: 50%; background: #e9e6eb; font-size: .6875rem; }
.forum-avatar + .forum-avatar { margin-left: -9px; }
.forum-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.forum-replies { flex: 0 0 auto; max-width: 40%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
time { flex: 0 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.forum-status { display: flex; align-items: center; height: 100%; margin: 0; color: var(--color-text-muted); font-size: .8125rem; }
button { background: none; border: 0; padding: 10px 4px; color: var(--color-primary); font: inherit; text-decoration: underline; cursor: pointer; }

.forum-skeleton { visibility: hidden; }
.forum-skeleton--visible { visibility: visible; }
.skeleton-bar { background: #e9e6eb; border-radius: 4px; animation: skeleton-pulse 1.6s ease-in-out infinite; height: 12px; }
.forum-avatar.skeleton-bar { height: 28px; border-radius: 50%; }
.skeleton-replies { flex: 0 1 44px; min-width: 20px; }
.skeleton-relative { flex: 0 1 60px; min-width: 24px; }
.forum-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@keyframes skeleton-pulse { 50% { opacity: .45; } }
@media (prefers-reduced-motion: reduce) { .skeleton-bar { animation: none; } }
</style>
