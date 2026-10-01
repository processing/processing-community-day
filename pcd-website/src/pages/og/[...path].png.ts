import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getCollection } from 'astro:content';
import type { APIRoute, GetStaticPaths } from 'astro';
import { loadZines } from '../../lib/zines';
import { OG_GALLERY_COVERS, renderOgImageCached } from '../../lib/og-image.mjs';

export const prerender = true;

type KitEntry = { data: { partnerCard?: unknown }; filePath?: string };

// Astro's image() metadata for an SVG carries no source path, so resolve the
// card's `logo` frontmatter value (relative to the page) back to a file.
async function partnerLogoPath(entry: KitEntry) {
  if (!entry.data.partnerCard || !entry.filePath) return undefined;
  const source = await readFile(resolve(entry.filePath), 'utf8');
  const logo = source.match(/^\s+logo:\s*(\S+)\s*$/m)?.[1];
  if (!logo) throw new Error(`${entry.filePath} has a partnerCard without a readable logo path`);
  return resolve(dirname(entry.filePath), logo);
}

export const getStaticPaths: GetStaticPaths = async () => {
  const [pages, zines] = await Promise.all([
    getCollection('organizerKit', (entry) => !entry.data.draft),
    loadZines(),
  ]);
  const partnersTitle = pages.find((entry) => entry.id === 'partners')?.data.title;
  const galleryCovers = zines.flatMap((zine) => zine.cover ? [zine.cover.sourcePath] : []).slice(0, OG_GALLERY_COVERS);
  return [
    ...await Promise.all(pages.map(async (entry) => ({
      params: { path: `organizer-kit/${entry.id}` },
      props: {
        title: entry.data.title,
        ...(entry.id === 'zines/zine-library'
          ? {}
          : { badge: 'Organizer Kit', eyebrow: entry.data.section ?? (entry.data.partnerCard ? partnersTitle : undefined) }),
        titleImage: await partnerLogoPath(entry),
        gallery: entry.id === 'zines/zine-library',
        covers: entry.id === 'zines/zine-library' ? galleryCovers : [],
      },
    }))),
    ...zines.map((zine) => ({
      params: { path: `zines/${zine.id}` },
      props: { title: zine.title, author: zine.created_by, covers: zine.cover ? [zine.cover.sourcePath] : [] },
    })),
  ];
};

export const GET: APIRoute = async ({ props }) => {
  const png = await renderOgImageCached(props as { title: string; titleImage?: string; eyebrow?: string; badge?: string; author?: string; covers: string[]; gallery?: boolean });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
