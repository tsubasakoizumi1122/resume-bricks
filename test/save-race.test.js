// Regression tests for two save races found in review (2026-10):
// 1. concurrent store writes shared one temp file (ENOENT, wrong content kept)
// 2. edits made while a save was in flight were marked as saved
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { createStore } from '../lib/store.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function freshStore() {
  const dir = await mkdtemp(path.join(tmpdir(), 'rb-race-'));
  const store = createStore(dir);
  await store.ensure();
  return { dir, store };
}

test('parallel puts to one id all succeed and the last one wins', async () => {
  const { dir, store } = await freshStore();
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) => store.put('resumes', 'same', { name: `v${i}` })),
  );
  assert.deepEqual(results.map((r) => r.status), Array(8).fill('fulfilled'));
  const doc = YAML.parse(await readFile(path.join(dir, 'resumes', 'same.yaml'), 'utf8'));
  assert.equal(doc.name, 'v7');
  const left = (await readdir(path.join(dir, 'resumes'))).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(left, [], 'no temp files left behind');
});

test('parallel creates with the same name get distinct ids', async () => {
  const { dir, store } = await freshStore();
  const ids = await Promise.all(
    Array.from({ length: 5 }, (_, i) => store.create('resumes', { name: `r${i}` }, 'Acme')),
  );
  assert.deepEqual(ids.map((r) => r.id), ['acme', 'acme-2', 'acme-3', 'acme-4', 'acme-5']);
  const files = (await readdir(path.join(dir, 'resumes'))).sort();
  assert.equal(files.length, 5);
});

test('a failed write does not block later writes', async () => {
  const { store } = await freshStore();
  await assert.rejects(store.put('resumes', 'x', null));
  await assert.rejects(store.remove('resumes', 'missing'));
  assert.deepEqual(await store.put('resumes', 'x', { name: 'ok' }), { id: 'x' });
});

// ---- client side: run the real save()/saveOnce()/setDirty() from public/app.js

function loadSave() {
  const src = readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  const grab = (sig) => {
    const start = src.indexOf(sig);
    assert.ok(start >= 0, `missing ${sig}`);
    let i = src.indexOf('{', start), depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) break;
    }
    return src.slice(start, i + 1);
  };
  const calls = [];
  let release = [];
  const ctx = {
    state: { dirty: false, rev: 0, saving: null, saveAgain: false, currentId: 'r1', comp: { name: 'A', sections: [] } },
    calls,
    release,
    LS_LAST: 'k',
    localStorage: { setItem() {} },
    structuredClone,
    $: () => ({ hidden: false, classList: { toggle() {} } }),
    ask: async () => 'Named',
    toast: () => {},
    renderTopbar: () => {},
    loadResumes: async () => {},
    api: {
      send: (method, url, body) =>
        new Promise((resolve) => {
          calls.push({ method, url, name: body.name });
          release.push(() => resolve(method === 'POST' ? { id: 'new-id' } : { id: 'r1' }));
        }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    [grab('function serialize()'), grab('function setDirty('), grab('async function save('), grab('async function saveOnce(')].join('\n') +
      '\nthis.save = save; this.setDirty = setDirty;',
    ctx,
  );
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { ctx, flush };
}

test('an edit made while saving stays unsaved', async () => {
  const { ctx, flush } = loadSave();
  ctx.setDirty(true);
  const p = ctx.save(false);
  await flush();
  ctx.state.comp.name = 'B';
  ctx.setDirty(true); // edit while the PUT is pending
  ctx.release.shift()();
  await p;
  assert.equal(ctx.calls[0].name, 'A');
  assert.equal(ctx.state.dirty, true, 'B is not on disk yet');
});

test('an untouched save clears dirty', async () => {
  const { ctx, flush } = loadSave();
  ctx.setDirty(true);
  const p = ctx.save(false);
  await flush();
  ctx.release.shift()();
  await p;
  assert.equal(ctx.state.dirty, false);
});

test('a second save during a first-time POST becomes a PUT, not a duplicate', async () => {
  const { ctx, flush } = loadSave();
  ctx.state.currentId = null;
  ctx.state.comp.name = 'Acme';
  ctx.setDirty(true);
  const p1 = ctx.save(false);
  await flush();
  ctx.state.comp.name = 'Acme v2';
  ctx.setDirty(true);
  const p2 = ctx.save(false); // e.g. Cmd+S pressed again
  assert.equal(ctx.calls.length, 1, 'no second request while the first is in flight');
  ctx.release.shift()();
  await flush(); await flush();
  assert.equal(ctx.calls.length, 2);
  assert.deepEqual([ctx.calls[1].method, ctx.calls[1].url, ctx.calls[1].name], ['PUT', '/api/resumes/new-id', 'Acme v2']);
  ctx.release.shift()();
  await Promise.all([p1, p2]);
  assert.equal(ctx.state.dirty, false);
});
