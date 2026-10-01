import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import satori from 'satori';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const LOGO_ASPECT = 1198 / 2072; // PCD_2026_Logo_Black.svg viewBox
const LOGO_TOP = 52;
const LOGO_GAP = 32; // minimum space between the logo and the title block
const LOGO_PER_FONT = 6.5; // logo width as a multiple of the title font size
const MAX_LOGO_WIDTH = 320;
const TITLE_BOTTOM = 64;
const MAX_BLOCK_HEIGHT = 310; // eyebrow, title, and byline; longer titles shrink to fit
const INK = '#292929';
const MUTED = '#6c567d';
const PURPLE = '#5503a4';
const PILL = {
  display: 'flex', padding: '10px 22px', borderRadius: 999,
  backgroundColor: 'rgba(85, 3, 164, 0.09)', color: PURPLE,
  fontSize: 24, letterSpacing: '0.1em', textTransform: 'uppercase',
};
const ASSET_PATHS = {
  background: 'src/images/og-background.png',
  logo: 'src/images/PCD_2026_logo/PCD_2026_Logo_Black.svg',
};
// The chip and footer use the semibold weight; the page title is lighter so it
// reads as distinct from the bold logo wordmark.
const TITLE_WEIGHT = 400;
const FONTS = [600, TITLE_WEIGHT].flatMap((weight) => ['latin', 'latin-ext'].map((subset) => ({
  weight,
  path: require.resolve(`@fontsource/space-grotesk/files/space-grotesk-${subset}-${weight}-normal.woff`),
})));

export function ogImagePath(section, id, base = '/') {
  return `${base.replace(/\/$/, '')}/og/${section}/${id}.png`;
}

const pngUri = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
let sharedAssets;

function loadSharedAssets() {
  // All inputs are local. The build never downloads fonts or artwork.
  return sharedAssets ??= Promise.all([
    sharp(resolve(ASSET_PATHS.background)).resize(OG_WIDTH, OG_HEIGHT).png().toBuffer(),
    sharp(resolve(ASSET_PATHS.logo)).resize({ width: 1000 }).png().toBuffer(),
    ...FONTS.map(({ path }) => readFile(path)),
  ]).then(([background, logo, ...fonts]) => ({
    background: pngUri(background),
    logo: pngUri(logo),
    fonts: fonts.map((data, index) => ({ name: 'Space Grotesk', data, weight: FONTS[index].weight, style: 'normal' })),
  }));
}

const element = (type, style, children, props = {}) => ({ type, props: { ...props, style, children } });
const img = (src, width, height, style = {}) => element('img', style, undefined, { src, width, height });

// The library is two straight columns of equal cards that run off the top and
// bottom of the canvas. The left column sits half a card lower than the right.
// The first three covers land fully in view; the rest peek in at the edges.
export const OG_GALLERY_COVERS = 5;
const GALLERY = { width: 232, height: 330, gap: 24, radius: 18 };
const GALLERY_LEFT = 656;
const GALLERY_RIGHT = GALLERY_LEFT + GALLERY.width + GALLERY.gap;
const GALLERY_STEP = GALLERY.height + GALLERY.gap;
const GALLERY_SLOTS = [
  { x: GALLERY_LEFT, y: 177 },
  { x: GALLERY_RIGHT, y: -27 },
  { x: GALLERY_RIGHT, y: -27 + GALLERY_STEP },
  { x: GALLERY_LEFT, y: 177 - GALLERY_STEP },
  { x: GALLERY_LEFT, y: 177 + GALLERY_STEP },
];
// A single zine's cover is a rounded rectangle inset from the right, top, and
// bottom edges, cropped to fit.
const SINGLE_INSET = 32;
const SINGLE = { width: 448, height: OG_HEIGHT - SINGLE_INSET * 2, radius: 24 };

/** A cover resized to the card, with antialiased rounded corners baked in. */
async function roundedPhoto(input, { width, height, radius, fit = 'cover' }) {
  const sized = await sharp(input).rotate().resize({ width, height, fit }).png()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = sized.info;
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${radius}" fill="#fff"/></svg>`);
  const data = await sharp(sized.data).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  return { src: pngUri(data), width: w, height: h };
}

/**
 * Render a static share card. Covers are source file paths in library order.
 * `badge` is an optional pill at the top right; `eyebrow` is optional plain
 * purple text above the title.
 */
export async function renderOgImage({ title, covers = [], gallery = false, eyebrow, badge, author }) {
  const assets = await loadSharedAssets();
  const photos = await Promise.all(covers.slice(0, gallery ? OG_GALLERY_COVERS : 1).map((path) => (gallery
    ? roundedPhoto(path, GALLERY)
    : roundedPhoto(path, SINGLE))));
  const hasPhotos = photos.length > 0;
  const titleWidth = hasPhotos ? 545 : 1060;

  const layout = async (fontSize, logoWidth) => {
    const measured = { title: 0, block: 0 };
    const svg = await satori(element('div', {
      width: OG_WIDTH, height: OG_HEIGHT, display: 'flex', position: 'relative',
      fontFamily: 'Space Grotesk', fontWeight: 600, color: INK,
      backgroundColor: '#faf8fc', overflow: 'hidden',
    }, [
      img(assets.background, OG_WIDTH, OG_HEIGHT, { position: 'absolute', top: 0, left: 0 }),
      img(assets.logo, logoWidth, Math.round(logoWidth * LOGO_ASPECT), { position: 'absolute', top: LOGO_TOP, left: 64, objectFit: 'contain' }),
      // The title block hangs from the bottom so every page shares a baseline
      // above the footer, whatever the title length.
      ...(badge ? [element('div', { ...PILL, position: 'absolute', top: LOGO_TOP, right: 64 }, badge)] : []),
      element('div', {
        position: 'absolute', left: 64, bottom: TITLE_BOTTOM, width: titleWidth,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
      }, [
        ...(eyebrow ? [element('div', {
          marginBottom: 14, color: PURPLE, fontSize: 32, letterSpacing: '0.06em', textTransform: 'uppercase',
        }, eyebrow)] : []),
        element('div', {
          width: titleWidth, marginLeft: -4, fontSize, lineHeight: 1.08, letterSpacing: '-0.04em', fontWeight: TITLE_WEIGHT,
        }, title, { id: 'page-title' }),
        ...(author ? [element('div', {
          width: titleWidth, marginTop: 16, display: 'flex', flexWrap: 'wrap', columnGap: 12,
          fontSize: 36, fontWeight: TITLE_WEIGHT, color: MUTED,
        }, [
          element('div', {}, 'by'),
          element('div', { color: PURPLE, fontWeight: 600 }, author),
        ])] : []),
      ], { id: 'title-block' }),
      ...photos.map((photo, index) => {
        if (!gallery) {
          return img(photo.src, photo.width, photo.height, {
            position: 'absolute', right: SINGLE_INSET, top: SINGLE_INSET,
          });
        }
        const { x, y } = GALLERY_SLOTS[index];
        // A hairline and soft shadow keep near-white covers distinct from the page.
        return element('div', {
          display: 'flex', position: 'absolute', left: x, top: y,
          width: photo.width, height: photo.height, borderRadius: GALLERY.radius,
          boxShadow: '0 0 0 1px rgba(30, 15, 45, 0.08), 0 10px 24px rgba(30, 15, 45, 0.14)',
        }, img(photo.src, photo.width, photo.height));
      }),
    ]), {
      width: OG_WIDTH, height: OG_HEIGHT, fonts: assets.fonts,
      onNodeDetected: (node) => {
        if (node.props.id === 'page-title') measured.title = node.height;
        if (node.props.id === 'title-block') measured.block = node.height;
      },
    });
    return { svg, ...measured };
  };

  // Measure the actual font layout, shrinking longer titles to keep them clear
  // of the logo. This also handles new content without manual line breaks.
  let fontSize = hasPhotos ? 68 : 92;
  let result = await layout(fontSize, 0);
  while (result.block > MAX_BLOCK_HEIGHT && fontSize > 28) {
    fontSize -= 2;
    result = await layout(fontSize, 0);
  }

  // The logo scales with the title text, but never grows into the title block.
  const roomAbove = OG_HEIGHT - TITLE_BOTTOM - result.block - LOGO_TOP - LOGO_GAP;
  const logoWidth = Math.floor(Math.min(
    fontSize * LOGO_PER_FONT, roomAbove / LOGO_ASPECT, titleWidth, MAX_LOGO_WIDTH,
  ));
  return sharp(Buffer.from((await layout(fontSize, logoWidth)).svg)).png().toBuffer();
}

// --- Build cache -----------------------------------------------------------
// Rendering takes seconds per image, so finished PNGs are kept on disk keyed by
// everything that can change them: the card content, the cover bytes, and the
// renderer itself (this file, artwork, fonts, and the satori/sharp versions).

const sha256 = (...parts) => {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest('hex');
};

export const defaultOgCacheDir = () => process.env.PCD_OG_CACHE_DIR
  || resolve('node_modules/.cache/pcd-og');

let templateHashPromise;
function templateHash() {
  return templateHashPromise ??= (async () => {
    // The source path, not import.meta.url: bundled builds run from a generated chunk.
    const files = [resolve('src/lib/og-image.mjs'), ...Object.values(ASSET_PATHS).map((path) => resolve(path)), ...FONTS.map(({ path }) => path)];
    const contents = await Promise.all(files.map((path) => readFile(path)));
    let versions = '';
    try {
      const lock = JSON.parse(await readFile(resolve('package-lock.json'), 'utf8'));
      versions = ['satori', 'sharp'].map((name) => lock.packages?.[`node_modules/${name}`]?.version).join();
    } catch {}
    return sha256(...contents, versions).slice(0, 16);
  })();
}

const coverHashes = new Map();
function coverHash(path) {
  // Keyed on size and mtime so dev edits are noticed; the digest covers content.
  return stat(path).then(({ size, mtimeMs }) => {
    const id = `${path}:${size}:${mtimeMs}`;
    if (!coverHashes.has(id)) coverHashes.set(id, readFile(path).then((data) => sha256(data)));
    return coverHashes.get(id);
  });
}

const prunedCaches = new Set();
async function pruneStaleTemplates(cacheDir, current) {
  if (prunedCaches.has(cacheDir)) return;
  prunedCaches.add(cacheDir);
  const entries = await readdir(cacheDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name !== current)
    .map((entry) => rm(join(cacheDir, entry.name), { recursive: true, force: true })));
}

/** Like `renderOgImage`, but reuses a cached PNG when nothing it depends on changed. */
export async function renderOgImageCached(options, { cacheDir = defaultOgCacheDir() } = {}) {
  const { title, covers = [], gallery = false, eyebrow, badge, author } = options;
  const template = await templateHash();
  const used = covers.slice(0, gallery ? OG_GALLERY_COVERS : 1);
  const key = sha256(JSON.stringify({ title, gallery, eyebrow, badge, author, covers: await Promise.all(used.map(coverHash)) }));
  const dir = join(cacheDir, template);
  const file = join(dir, `${key}.png`);

  try {
    return await readFile(file);
  } catch {}

  const png = await renderOgImage(options);
  try {
    await mkdir(dir, { recursive: true });
    await pruneStaleTemplates(cacheDir, template);
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, png);
    await rename(temporary, file);
  } catch {
    // A read-only or full cache location must never fail the build.
  }
  return png;
}
