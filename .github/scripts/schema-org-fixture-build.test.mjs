import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

// No published event is a placeholder, and data.json already drops them, so
// build with a placeholder fixture to prove its page emits no JSON-LD.
const REPO_ROOT = resolve(new URL('../..', import.meta.url).pathname);
const WEBSITE = join(REPO_ROOT, 'pcd-website');
const SLUG = 'schema-placeholder-fixture';
const FIXTURE = join(REPO_ROOT, '.github/scripts/fixtures/events', SLUG);
const DEST = join(WEBSITE, 'src/content/events', SLUG);
const DIST = join(WEBSITE, 'dist');
const LD_JSON_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

function blocks(pathFromDist) {
  const html = readFileSync(join(DIST, pathFromDist, 'index.html'), 'utf8');
  return [...html.matchAll(LD_JSON_RE)].map((match) => JSON.parse(match[1]));
}

test('placeholder events emit no JSON-LD and are left out of the events ItemList', () => {
  assert.ok(!existsSync(DEST), `${DEST} already exists — refusing to overwrite`);
  const { uid } = JSON.parse(readFileSync(join(FIXTURE, 'metadata.json'), 'utf8'));
  try {
    cpSync(FIXTURE, DEST, { recursive: true });
    execFileSync('npm', ['run', 'build'], { cwd: WEBSITE, stdio: 'pipe' });

    const canonicalPath = `event/${SLUG}-${uid}`;
    assert.ok(existsSync(join(DIST, canonicalPath, 'index.html')), 'the placeholder canonical page should still be generated');
    assert.equal(blocks(canonicalPath).length, 0, 'placeholder pages must not emit JSON-LD');

    const feed = JSON.parse(readFileSync(join(DIST, 'data.json'), 'utf8'));
    const [list] = blocks('events');
    const urls = list.itemListElement.map((item) => item.url);
    assert.ok(!urls.includes(`https://day.processing.org/${canonicalPath}/`), 'placeholder URL must not be listed');
    assert.equal(urls.length, feed.event_count);
  } finally {
    rmSync(DEST, { recursive: true, force: true });
  }
});
