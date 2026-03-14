
> [!NOTE] 
> This project is in early development. The map and event data are not yet complete, but we welcome contributions from the community!

# Processing Community Day Website

A global map of Processing Community Day events.

In 2026, Processing turns 25. To mark the occasion, Processing Community Day (PCD) returns as a worldwide celebration! PCD is a global network of community-led events that brings together artists, designers, technologists, educators, and open-source communities around the world.

For more information about PCD 2026 and how to get involved, see the [forum thread](https://discourse.processing.org/t/pcd-worldwide-2026-call-for-organizers/48081).

## About this project

For now it's a simple static map showcasing PCD events around the world. The goal is to have something ready to share in the next few weeks to help organizers promote their events and encourage more people to sign up to host events in new locations.

This will eventually grow into a full-featured site with resources, an organizer kit, guidelines, and more.

The map site is open source and contributions are welcome!

## Adding an event

Open a GitHub Issue using the **New Event** template. The intake workflow validates the submission and opens a pull request with the generated event files. The PR must be reviewed and merged by a maintainer before the event appears on the map.

## Tech

- **[Astro 5](https://astro.build)** — static site generation
- **[Vue 3](https://vuejs.org)** — all interactive UI as client-only island components
- **[Leaflet](https://leafletjs.com)** — for map rendering and interactivity
- **[leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster)** — for clustering map markers
- **[Open Location Code](https://github.com/google/open-location-code)** — for geocoding plus codes to lat/lng
- **[GitHub Workflows](https://github.com/features/actions)** — for event submission, review, and data management

## Developing

```sh
cd pcd-website
npm install
npm run dev      # localhost:4321
npm run build    # production build → dist/
npm run preview  # preview production build
```

## Looking for the old PCD website? 

See [processing/processing-community-day-website-archived](https://github.com/processing/processing-community-day-website-archived) or the [Wayback Machine archive](https://web.archive.org/web/20221201000000*/https://day.processing.org/).

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.