import { getCollection } from 'astro:content';
import type { APIRoute, GetStaticPaths } from 'astro';
import { loadZines } from '../../lib/zines';
import { OG_GALLERY_COVERS, renderOgImageCached } from '../../lib/og-image.mjs';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  const [pages, zines] = await Promise.all([
    getCollection('organizerKit', (entry) => !entry.data.draft),
    loadZines(),
  ]);
  const partnersTitle = pages.find((entry) => entry.id === 'partners')?.data.title;
  const galleryCovers = zines.flatMap((zine) => zine.cover ? [zine.cover.sourcePath] : []).slice(0, OG_GALLERY_COVERS);
  return [
    ...pages.map((entry) => ({
      params: { path: `organizer-kit/${entry.id}` },
      props: {
        title: entry.data.title,
        ...(entry.id === 'zines/zine-library'
          ? {}
          : { badge: 'Organizer Kit', eyebrow: entry.data.section ?? (entry.data.partnerCard ? partnersTitle : undefined) }),
        gallery: entry.id === 'zines/zine-library',
        covers: entry.id === 'zines/zine-library' ? galleryCovers : [],
      },
    })),
    ...zines.map((zine) => ({
      params: { path: `zines/${zine.id}` },
      props: { title: zine.title, author: zine.created_by, covers: zine.cover ? [zine.cover.sourcePath] : [] },
    })),
  ];
};

export const GET: APIRoute = async ({ props }) => {
  const png = await renderOgImageCached(props as { title: string; eyebrow?: string; badge?: string; author?: string; covers: string[]; gallery?: boolean });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
