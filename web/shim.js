// The web version has no server. This answers the app's /api/... requests inside the
// browser instead: storage in IndexedDB, file reading and GitHub lookups done locally.
import { createDb, HttpError } from './db.js';
import { idHint } from '../lib/ids.js';
import { githubToText } from '../lib/github.js';
// The PDF/Word readers and the zip code are big: load them only when they are needed.
const extract = () => import('../lib/extract.js');
const backup = () => import('./backup.js');
import SAMPLE from 'virtual:sample-data';

const db = createDb();

// First visit: copy in the fictional sample person, the same way the local app seeds my-data/.
const seeded = db.ready.then(async () => {
  if (await db.getMeta('seeded')) return false;
  for (const kind of ['blocks', 'resumes']) {
    for (const [id, doc] of Object.entries(SAMPLE[kind])) await db.put(kind, id, doc);
  }
  await db.setMeta('seeded', new Date().toISOString());
  return true;
});

// Ask the browser not to clear this site's data when space runs low (best effort).
try { navigator.storage?.persist?.(); } catch { /* ignore */ }

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function handle(path, opts) {
  await seeded;
  const method = (opts.method || 'GET').toUpperCase();
  const body = async () => (opts.body ? JSON.parse(opts.body) : {});

  if (path === '/api/meta') return json({ dataDir: 'this browser', seeded: await seeded, web: true });

  if (path === '/api/extract') {
    const buf = await new Response(opts.body).arrayBuffer();
    if (!buf.byteLength) throw new HttpError(400, 'The file is empty.');
    const headers = new Headers(opts.headers || {});
    const name = decodeURIComponent(headers.get('x-filename') || '');
    let text;
    try {
      const { fileToText } = await extract();
      text = await fileToText(buf, name, headers.get('content-type') || '');
    } catch (e) {
      throw new HttpError(e.status || 422, e.status ? e.message : 'Could not read that file. Try a PDF, .docx or .pptx, or paste the text.');
    }
    if (!text.trim()) throw new HttpError(422, 'No text found in that file. If it is a scanned image, paste the text instead.');
    return json({ text });
  }

  if (path === '/api/source') {
    const { github, folder } = await body();
    if (github) return json(await githubToText(github));
    if (folder) throw new HttpError(400, 'Folder paths only work in the local app. Add the project files above, or use a GitHub link.');
    throw new HttpError(400, 'Give a GitHub link.');
  }

  const m = path.match(/^\/api\/(blocks|resumes)(?:\/([^/]+))?$/);
  if (!m) throw new HttpError(404, 'not found');
  const [, kind, raw] = m;
  const id = raw ? decodeURIComponent(raw) : null;
  if (method === 'GET') return json(id ? await db.get(kind, id) : await db.list(kind));
  if (method === 'POST' && !id) {
    const b = await body();
    return json(await db.create(kind, b, idHint(kind, b)), 201);
  }
  if (method === 'PUT' && id) return json(await db.put(kind, id, await body()));
  if (method === 'DELETE' && id) return json(await db.remove(kind, id));
  throw new HttpError(405, 'method not allowed');
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, opts = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.origin !== location.origin || !url.pathname.includes('/api/')) {
    return realFetch(input, opts);
  }
  const path = url.pathname.slice(url.pathname.indexOf('/api/'));
  try {
    return await handle(path, opts);
  } catch (e) {
    console.error(e);
    return json({ error: e.message || String(e) }, e.status || 500);
  }
};

// What the app does differently in the browser (see `host` in public/app.js).
window.RB_HOST = {
  ...(window.RB_HOST || {}),
  web: true,
  noFolder: true,
  trashNote: 'It is moved to the trash in this browser (kept in backups), not erased.',
  backup: {
    export: async () => (await backup()).exportBackup(db),
    read: async (file) => (await backup()).readBackup(file),
  },
};
