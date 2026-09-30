import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ogImagePath, renderOgImage, renderOgImageCached } from '../../pcd-website/src/lib/og-image.mjs';

const WEBSITE = fileURLToPath(new URL('../../pcd-website/', import.meta.url));
const DIST = join(WEBSITE, 'dist');
const require = createRequire(join(WEBSITE, 'package.json'));
const sharp = require('sharp');

async function assertPng(input) {
  const { info } = await sharp(input).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1200);
  assert.equal(info.height, 630);
}

test('every published Organizer Kit and zine page links to an emitted PNG in both social tags', async () => {
  const images = new Set();
  for (const section of ['organize', 'activity-guide']) {
    const pages = readdirSync(join(DIST, section), { recursive: true })
      .filter((path) => path.endsWith('index.html'));
    assert.ok(pages.length > 0);
    for (const page of pages) {
      const html = readFileSync(join(DIST, section, page), 'utf8');
      const og = html.match(/<meta property="og:image" content="([^"]+)"/);
      const twitter = html.match(/<meta name="twitter:image" content="([^"]+)"/);
      assert.ok(og, `${section}/${page} needs an OG image`);
      assert.equal(twitter?.[1], og[1]);
      const url = new URL(og[1]);
      assert.equal(url.origin, 'https://day.processing.org');
      assert.ok(url.pathname.startsWith('/og/'));
      images.add(url.pathname);
    }
  }
  for (const image of images) await assertPng(join(DIST, image));

  const emitted = readdirSync(join(DIST, 'og'), { recursive: true })
    .filter((path) => path.endsWith('.png')).map((path) => `/og/${path}`);
  assert.deepEqual([...images].sort(), emitted.sort(), 'no unused or draft OG images should be emitted');
  const intro = readFileSync(join(DIST, 'organize/index.html'), 'utf8');
  assert.ok(intro.includes('/og/organizer-kit/getting-started/introduction.png'));
});

test('image paths preserve nested slugs and a deployment base', () => {
  assert.equal(ogImagePath('organizer-kit', 'zines/zine-library', '/pcd/'), '/pcd/og/organizer-kit/zines/zine-library.png');
});

test('rendering works offline with no cover, fewer than five gallery covers, and long accented titles', async () => {
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  process.chdir(WEBSITE);
  globalThis.fetch = () => { throw new Error('OG generation must not fetch external assets'); };
  try {
    const cover = resolve('src/content/zines/make-your-first-generative-artwork/cover.jpg');
    const renders = [];
    for (const covers of [[], [cover], [cover, cover]]) {
      const png = await renderOgImage({ title: 'Créer ensemble — an introduction to creative coding and organizing your first community event', covers, gallery: true });
      await assertPng(png);
      renders.push(png);
    }
    assert.notDeepEqual(renders[0], renders[1], 'a cover should change the image');
    assert.notDeepEqual(renders[1], renders[2], 'the second cover should be visible');
    await assertPng(await renderOgImage({ title: 'A zine without a cover' }));
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
  }
});

test('cached rendering reuses a PNG until the title, eyebrow, cover bytes, or gallery flag change', async () => {
  const originalCwd = process.cwd();
  const cacheDir = mkdtempSync(join(tmpdir(), 'pcd-og-cache-'));
  const coverDir = mkdtempSync(join(tmpdir(), 'pcd-og-cover-'));
  process.chdir(WEBSITE);
  try {
    const source = resolve('src/content/zines/make-your-first-generative-artwork/cover.jpg');
    const cover = join(coverDir, 'cover.jpg');
    copyFileSync(source, cover);
    const cached = (options) => renderOgImageCached(options, { cacheDir });
    const entries = () => readdirSync(cacheDir, { recursive: true }).filter((path) => path.endsWith('.png'));
    const base = { title: 'Cached card', covers: [cover] };

    const first = await cached(base);
    await assertPng(first);
    assert.equal(entries().length, 1);
    assert.deepEqual(await cached(base), first);
    assert.equal(entries().length, 1, 'identical input must not create another entry');

    // Overwrite the entry with a sentinel to prove the second call reads the cache.
    const [entry] = entries();
    const sentinel = await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#123456' } }).png().toBuffer();
    writeFileSync(join(cacheDir, entry), sentinel);
    assert.deepEqual(await cached(base), sentinel);

    await cached({ ...base, title: 'Another title' });
    await cached({ ...base, eyebrow: 'Zine' });
    await cached({ ...base, gallery: true });
    assert.equal(entries().length, 4);

    // Same path, different bytes (and a later mtime) must miss the cache.
    await new Promise((done) => setTimeout(done, 20));
    writeFileSync(cover, await sharp(source).negate().jpeg().toBuffer());
    await cached(base);
    assert.equal(entries().length, 5);
    // Only the first cover of a single-cover card matters.
    await cached({ ...base, covers: [cover, source] });
    assert.equal(entries().length, 5);
  } finally {
    process.chdir(originalCwd);
    rmSync(cacheDir, { recursive: true, force: true });
    rmSync(coverDir, { recursive: true, force: true });
  }
});

test('an unwritable cache location never fails rendering', async () => {
  const originalCwd = process.cwd();
  const blocker = mkdtempSync(join(tmpdir(), 'pcd-og-blocker-'));
  const file = join(blocker, 'file');
  writeFileSync(file, '');
  process.chdir(WEBSITE);
  try {
    await assertPng(await renderOgImageCached({ title: 'No cache' }, { cacheDir: join(file, 'nested') }));
  } finally {
    process.chdir(originalCwd);
    rmSync(blocker, { recursive: true, force: true });
  }
});
