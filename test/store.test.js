import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, initDataDir, isValidId, slugify } from '../lib/store.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function freshStore() {
  const dir = await mkdtemp(path.join(tmpdir(), 'rb-'));
  const store = createStore(dir);
  await store.ensure();
  return { dir, store };
}

test('slugify and id validation', () => {
  assert.equal(slugify('Experience – Harbor & Pine!'), 'experience-harbor-pine');
  assert.equal(slugify('日本語だけ'), 'item');
  assert.ok(isValidId('experience-harbor-pine'));
  assert.ok(!isValidId('../etc/passwd'));
  assert.ok(!isValidId('Upper'));
  assert.ok(!isValidId(''));
});

test('create, get, put, list round-trip as YAML', async () => {
  const { dir, store } = await freshStore();
  const { id } = await store.create('blocks', { type: 'skills', label: 'Tools', items: ['Excel'] }, 'skills-tools');
  assert.equal(id, 'skills-tools');
  const again = await store.create('blocks', { type: 'skills' }, 'skills-tools');
  assert.equal(again.id, 'skills-tools-2', 'duplicate ids get a suffix');

  await store.put('blocks', id, { id: 'ignored', type: 'skills', label: 'Tools', items: ['Excel', 'SQL'] });
  const got = await store.get('blocks', id);
  assert.deepEqual(got.items, ['Excel', 'SQL']);
  assert.equal(got.id, id);

  const raw = await readFile(path.join(dir, 'blocks', `${id}.yaml`), 'utf8');
  assert.match(raw, /label: Tools/);
  assert.doesNotMatch(raw, /ignored/, 'id is not written into the file');

  assert.equal((await store.list('blocks')).length, 2);
});

test('rejects path traversal and bad bodies', async () => {
  const { store } = await freshStore();
  await assert.rejects(store.get('blocks', '../../secret'), { status: 400 });
  await assert.rejects(store.put('blocks', 'ok', ['array']), { status: 400 });
  await assert.rejects(store.list('nope'), { status: 404 });
});

test('remove moves the file to .trash', async () => {
  const { dir, store } = await freshStore();
  const { id } = await store.create('resumes', { name: 'X' }, 'x');
  await store.remove('resumes', id);
  assert.equal((await store.list('resumes')).length, 0);
  const trash = await readdir(path.join(dir, '.trash'));
  assert.equal(trash.length, 1);
  assert.match(trash[0], /^resumes-x-/);
});

test('broken YAML shows up as an error entry instead of crashing', async () => {
  const { dir, store } = await freshStore();
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(dir, 'blocks', 'bad.yaml'), 'type: [unclosed');
  const list = await store.list('blocks');
  assert.equal(list[0].type, '_error');
});

test('sample data seeds a fresh data dir and every reference resolves', async () => {
  const dir = path.join(await mkdtemp(path.join(tmpdir(), 'rb-')), 'data');
  assert.equal(await initDataDir(dir, path.join(ROOT, 'sample-data')), true);
  assert.equal(await initDataDir(dir, path.join(ROOT, 'sample-data')), false, 'second run does not reseed');
  const store = createStore(dir);
  const ids = new Set((await store.list('blocks')).map((b) => b.id));
  for (const r of await store.list('resumes')) {
    assert.ok(ids.has(r.header), `${r.id}: header ${r.header}`);
    for (const s of r.sections) for (const it of s.items) assert.ok(ids.has(it.block), `${r.id}: ${it.block}`);
  }
});
