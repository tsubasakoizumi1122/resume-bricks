#!/usr/bin/env node
// Resume Bricks: tiny local server. No build step, one dependency (yaml).
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { createStore, initDataDir } from './lib/store.js';
import { fileToText } from './lib/extract.js';
import { githubToText, folderToText } from './lib/sources.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.RESUME_DATA || path.join(ROOT, 'my-data'));
const SAMPLE_DIR = path.join(ROOT, 'sample-data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const MAX_BODY = 2 * 1024 * 1024;
const MAX_UPLOAD = 15 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const seeded = await initDataDir(DATA_DIR, SAMPLE_DIR);
const store = createStore(DATA_DIR);
await store.ensure();

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    throw Object.assign(new Error('expected application/json'), { status: 415 });
  }
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 });
  }
}

async function readRaw(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('That file is larger than 15 MB.'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

// Only accept requests addressed to this machine (blocks DNS-rebinding / cross-site writes).
function isLocalRequest(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      const o = new URL(origin).hostname;
      if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(o)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function idHint(kind, body) {
  if (kind === 'resumes') return body.name || 'resume';
  const label = body.title || body.org || body.name || body.school || body.label || body.heading || '';
  return `${body.type || 'brick'}-${label}`;
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/meta') {
    return send(res, 200, { dataDir: DATA_DIR, seeded });
  }
  // Describe a piece of work from a GitHub link or a folder on this computer.
  if (pathname === '/api/source') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    const { github, folder } = await readJson(req);
    if (github) return send(res, 200, await githubToText(github));
    if (folder) return send(res, 200, await folderToText(folder));
    return send(res, 400, { error: 'Give a GitHub link or a folder path.' });
  }
  // Upload a resume file (raw body); returns its text. Parsing into bricks happens in the browser.
  if (pathname === '/api/extract') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    const buf = await readRaw(req, MAX_UPLOAD);
    if (!buf.length) return send(res, 400, { error: 'The file is empty.' });
    const name = decodeURIComponent(String(req.headers['x-filename'] || ''));
    try {
      const text = await fileToText(buf, name, String(req.headers['content-type'] || ''));
      if (!text.trim()) {
        return send(res, 422, { error: 'No text found in that file. If it is a scanned image, paste the text instead.' });
      }
      return send(res, 200, { text });
    } catch (e) {
      return send(res, e.status || 422, { error: e.status ? e.message : 'Could not read that file. Try a PDF, .docx or .pptx, or paste the text.' });
    }
  }
  const m = pathname.match(/^\/api\/(blocks|resumes)(?:\/([^/]+))?$/);
  if (!m) return send(res, 404, { error: 'not found' });
  const kind = m[1];
  const id = m[2] ? decodeURIComponent(m[2]) : null;

  switch (req.method) {
    case 'GET':
      return send(res, 200, id ? await store.get(kind, id) : await store.list(kind));
    case 'POST': {
      if (id) break;
      const body = await readJson(req);
      return send(res, 201, await store.create(kind, body, idHint(kind, body)));
    }
    case 'PUT':
      if (!id) break;
      return send(res, 200, await store.put(kind, id, await readJson(req)));
    case 'DELETE':
      if (!id) break;
      return send(res, 200, await store.remove(kind, id));
  }
  return send(res, 405, { error: 'method not allowed' });
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'forbidden' });
  const data = await fs.readFile(full).catch(() => null);
  if (!data) return send(res, 404, { error: 'not found' });
  send(res, 200, data, MIME[path.extname(full)] || 'application/octet-stream');
}

const server = http.createServer(async (req, res) => {
  try {
    if (!isLocalRequest(req)) return send(res, 403, { error: 'local access only' });
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    return await serveStatic(res, pathname);
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try: PORT=4322 npm start`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  🧱 Resume Bricks is running at ${url}`);
  console.log(`  📁 Your data: ${DATA_DIR}${seeded ? '  (seeded with sample data)' : ''}`);
  console.log('  Press Ctrl+C to stop.\n');
  if (!process.env.NO_OPEN) {
    const cmd =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
    exec(`${cmd} ${url}`, () => {});
  }
});
