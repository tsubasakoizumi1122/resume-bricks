#!/usr/bin/env node
// Builds docs/demo.html: the whole app in one file, with sample data baked in
// and an in-memory stand-in for the local server. Handy for GitHub Pages or a
// quick look without installing anything. Changes in the demo are not saved to disk.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = (f) => fs.readFile(path.join(ROOT, 'public', f), 'utf8');

async function readKind(kind) {
  const dir = path.join(ROOT, 'sample-data', kind);
  const out = {};
  for (const f of (await fs.readdir(dir)).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    out[f.replace(/\.ya?ml$/, '')] = YAML.parse(await fs.readFile(path.join(dir, f), 'utf8'));
  }
  return out;
}

const stripModule = (src) =>
  src.replace(/^import .*$/gm, '').replace(/^export (const|function) /gm, '$1 ');

// Every module app.js uses, dependencies first (read from the import lines, so new files are never missed).
async function moduleOrder(entry, seen = new Set(), out = []) {
  if (seen.has(entry)) return out;
  seen.add(entry);
  const src = await pub(entry);
  for (const [, dep] of src.matchAll(/^import .* from '\.\/([\w.-]+\.js)';$/gm)) await moduleOrder(dep, seen, out);
  out.push(entry);
  return out;
}
const ORDER = await moduleOrder('app.js');
const files = Object.fromEntries(await Promise.all(ORDER.map(async (f) => [f, await pub(f)])));
const data = { blocks: await readKind('blocks'), resumes: await readKind('resumes') };

const shim = `
// ---- demo: in-memory replacement for the local server ----
const DEMO_DB = ${JSON.stringify(data)};
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\\s_-]/g, '').trim().replace(/[\\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'item';
const realFetch = window.fetch.bind(window);
window.fetch = async (url, opts = {}) => {
  const m = String(url).match(/^\\/api\\/(blocks|resumes)(?:\\/([^/]+))?$/);
  if (!m) return realFetch(url, opts);
  const [, kind, rawId] = m;
  const id = rawId && decodeURIComponent(rawId);
  const db = DEMO_DB[kind];
  const method = (opts.method || 'GET').toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (body) delete body.id;
  const ok = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
  if (method === 'GET') {
    if (!id) return ok(Object.entries(db).map(([k, v]) => ({ ...structuredClone(v), id: k })));
    return db[id] ? ok({ ...structuredClone(db[id]), id }) : ok({ error: 'not found' }, 404);
  }
  if (method === 'POST') {
    const hint = kind === 'resumes' ? body.name : (body.type || 'brick') + '-' + (body.title || body.org || body.name || body.school || body.label || body.heading || '');
    let nid = slug(hint), base = nid;
    for (let n = 2; db[nid]; n++) nid = base + '-' + n;
    db[nid] = body;
    return ok({ id: nid }, 201);
  }
  if (method === 'PUT') { db[id] = body; return ok({ id }); }
  if (method === 'DELETE') { delete db[id]; return ok({ ok: true }); }
};
`;

const css = await pub('styles.css');
const resumeCss = await pub('resume.css');
const themeCss = await pub('theme.css');
const js = ORDER.map((f) => stripModule(files[f])).join('\n');
const html = (await pub('index.html'))
  .replace('<link rel="stylesheet" href="styles.css" />', () => `<style>\n${css}\n</style>`)
  .replace('<link rel="stylesheet" href="resume.css" />', () => `<style>\n${resumeCss}\n</style>`)
  .replace('<link rel="stylesheet" href="theme.css" />', () => `<style>\n${themeCss}\n</style>`)
  .replace(
    '<body>',
    () => `<body>\n  <div class="demo-banner">Demo: edits stay in this tab only. Clone the repo and run <code>npm start</code> to save to your own YAML files.</div>`,
  )
  .replace(
    '</head>',
    `<style>.demo-banner{background:rgba(108,92,231,.12);color:inherit;font-size:12px;padding:6px 20px;border-bottom:1px solid rgba(108,92,231,.2)}.demo-banner code{background:rgba(255,255,255,.35);padding:0 4px;border-radius:4px}@media print{.demo-banner{display:none}}</style>\n</head>`,
  )
  .replace(
    '<script type="module" src="app.js"></script>',
    () => `<script type="module">\n${shim}\n${js}\n</script>`,
  );

const out = path.join(ROOT, 'docs', 'demo.html');
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, html);
console.log(`Wrote ${path.relative(ROOT, out)} (${(html.length / 1024).toFixed(0)} KB; ${ORDER.join(', ')})`);
