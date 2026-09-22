<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue';

const emit = defineEmits<{ reopen: []; complete: [] }>();
// Match the CSS keyframes: close for 420ms, hold for 1500ms, open for 480ms.
const duration = 2400;
let reopenTimer: number | undefined;
let finishTimer: number | undefined;
let reopened = false;
let finished = false;

function reopen() {
  if (reopened) return;
  reopened = true;
  emit('reopen');
}

function finish() {
  if (finished) return;
  finished = true;
  reopen();
  emit('complete');
}

function handleKeydown(event: KeyboardEvent) {
  // Keep focus on the triggering control while the screen is covered.
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.key === 'Escape') finish();
}

function handleVisibilityChange() {
  if (document.hidden) finish();
}

onMounted(() => {
  reopenTimer = window.setTimeout(reopen, duration * 0.8);
  finishTimer = window.setTimeout(finish, duration);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

onBeforeUnmount(() => {
  window.clearTimeout(reopenTimer);
  window.clearTimeout(finishTimer);
  document.removeEventListener('keydown', handleKeydown, true);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});
</script>

<template>
  <Teleport to="body">
    <div class="eyelid-blink" aria-hidden="true" :style="{ '--blink-duration': `${duration}ms` }">
      <div class="eyelid eyelid--top"></div>
      <div class="eyelid eyelid--bottom"></div>
    </div>
  </Teleport>
</template>

<style scoped>
.eyelid-blink {
  position: fixed;
  inset: 0;
  z-index: 10000;
  overflow: hidden;
  pointer-events: auto;
  touch-action: none;
}

.eyelid {
  --eyelid-overscan: 6rem;
  position: absolute;
  left: -10%;
  width: 120%;
  height: 65%;
  filter: blur(1.5rem);
  will-change: transform;
  animation: close-eyelid var(--blink-duration) both;
}

.eyelid::before {
  content: '';
  position: absolute;
  inset: calc(-1 * var(--eyelid-overscan));
  background: #1c1022;
  mask-image: var(--eyelid-mask);
}

.eyelid--top {
  top: 0;
  --eyelid-mask: radial-gradient(ellipse 50% 36% at 50% 118%, transparent calc(100% - 1px), #000 100%);
  --open-position: calc(-110% - var(--eyelid-overscan));
}

.eyelid--bottom {
  bottom: 0;
  --eyelid-mask: radial-gradient(ellipse 50% 36% at 50% -18%, transparent calc(100% - 1px), #000 100%);
  --open-position: calc(110% + var(--eyelid-overscan));
}

@keyframes close-eyelid {
  0% {
    transform: translateY(var(--open-position));
    animation-timing-function: cubic-bezier(0.55, 0, 0.8, 0.5);
  }
  17.5%, 80% {
    transform: translateY(0);
    animation-timing-function: cubic-bezier(0.2, 0.5, 0.3, 1);
  }
  100% { transform: translateY(var(--open-position)); }
}

@media (prefers-reduced-motion: reduce) {
  .eyelid-blink {
    background: #1c1022;
    animation: fade-eyelid var(--blink-duration) both;
  }
  .eyelid { display: none; }
}

@keyframes fade-eyelid {
  0%, 100% { opacity: 0; }
  17.5%, 80% { opacity: 1; }
}
</style>
