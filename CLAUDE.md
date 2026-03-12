# pcd-website-mvp-2 Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-03

## Active Technologies

- TypeScript 5.x / Node.js 20+ + Astro 5.x (static output), Vue 3, Leaflet 1.9, leaflet.markercluster, open-location-code, focus-trap, IBM Plex Sans (Google Fonts) (001-pcd-website-v2)

## Project Structure

```text
backend/
frontend/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript 5.x / Node.js 20+: Follow standard conventions

## Recent Changes

- 001-pcd-website-v2: Added TypeScript 5.x / Node.js 20+ + Astro 5.x (static output), Vue 3, Leaflet 1.9, leaflet.markercluster, open-location-code, focus-trap, IBM Plex Sans (Google Fonts)

<!-- MANUAL ADDITIONS START -->
## UI Guidelines

- Always support both light and dark mode for any new or modified UI elements.
- Dark mode is toggled via `[data-theme="dark"]` on an ancestor element.
- Dark mode overrides for global/non-scoped elements go in `src/styles/global.css`.
- Vue scoped styles cannot target ancestor-based dark mode selectors — use global.css for those overrides.
<!-- MANUAL ADDITIONS END -->
