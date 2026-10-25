#!/usr/bin/env node
// Builds docs/app/: the web version of Resume Bricks for GitHub Pages (or any static host).
// Same app as `npm start`, but data lives in the browser (IndexedDB) and files are read
// in the browser too, so nothing is ever uploaded. See web/ for the browser-only parts.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { build } from 'esbuild';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.env.RB_WEB_OUT || path.join(ROOT, 'docs', 'app'));

async function readKind(kind) {
  const dir = path.join(ROOT, 'sample-data', kind);
  const out = {};
  for (const f of (await fs.readdir(dir)).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    out[f.replace(/\.ya?ml$/, '')] = YAML.parse(await fs.readFile(path.join(dir, f), 'utf8'));
  }
  return out;
}
const sample = { blocks: await readKind('blocks'), resumes: await readKind('resumes') };

const sampleData = {
  name: 'sample-data',
  setup(b) {
    b.onResolve({ filter: /^virtual:sample-data$/ }, () => ({ path: 'sample-data', namespace: 'virtual' }));
    b.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({ contents: `export default ${JSON.stringify(sample)};`, loader: 'js' }));
  },
};

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });

const result = await build({
  entryPoints: [path.join(ROOT, 'web', 'main.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome110', 'safari16', 'firefox115'],
  minify: true,
  sourcemap: false,
  legalComments: 'eof', // keep each library's license notice inside its own file
  outdir: OUT,
  entryNames: 'app',
  chunkNames: 'chunks/[name]-[hash]',
  splitting: true,
  plugins: [sampleData],
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  logLevel: 'warning',
  metafile: true,
});

// Every third-party package that ended up in the bundle, with its license text.
const pkgs = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = input.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//g);
  if (m) pkgs.add(m[m.length - 1].replace(/^node_modules\/|\/$/g, ''));
}
const notices = [];
for (const name of [...pkgs].sort()) {
  const dir = path.join(ROOT, 'node_modules', name);
  const meta = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
  const files = (await fs.readdir(dir)).filter((f) => /^(licen[sc]e|copying|notice)/i.test(f));
  const texts = await Promise.all(files.map((f) => fs.readFile(path.join(dir, f), 'utf8')));
  notices.push(`${'='.repeat(72)}\n${name}@${meta.version} (${meta.license || 'see below'})\n${meta.homepage || ''}\n${'='.repeat(72)}\n\n${texts.join('\n\n') || `License: ${meta.license}`}\n`);
}
// unpdf ships Mozilla's pdf.js inside its own files; pdf.js is Apache-2.0.
if (pkgs.has('unpdf')) {
  const apache = await fs.readFile(path.join(ROOT, 'web', 'licenses', 'pdfjs-LICENSE.txt'), 'utf8');
  notices.push(`${'='.repeat(72)}\npdf.js by Mozilla (Apache-2.0), included inside unpdf\nhttps://github.com/mozilla/pdf.js\n${'='.repeat(72)}\n\n${apache}\n`);
}
await fs.writeFile(
  path.join(OUT, 'THIRD-PARTY-LICENSES.txt'),
  `The web version of Resume Bricks bundles these open-source packages. Each keeps its own license.\n\n${notices.join('\n')}`,
);

for (const f of ['styles.css', 'resume.css', 'theme.css']) await fs.copyFile(path.join(ROOT, 'public', f), path.join(OUT, f));

const html = (await fs.readFile(path.join(ROOT, 'public', 'index.html'), 'utf8')).replace(
  '</head>',
  `  <meta name="description" content="Stock your career history as reusable bricks and snap them into a tailored resume for every application. Runs in your browser; nothing is uploaded." />\n</head>`,
);
await fs.writeFile(path.join(OUT, 'index.html'), html);

const kb = async (f) => ((await fs.stat(f)).size / 1024).toFixed(0);
const chunks = await fs.readdir(path.join(OUT, 'chunks')).catch(() => []);
let total = 0;
for (const c of chunks) total += (await fs.stat(path.join(OUT, 'chunks', c))).size;
console.log(`Wrote docs/app/ (app.js ${await kb(path.join(OUT, 'app.js'))} KB, plus ${chunks.length} on-demand chunks ${(total / 1024).toFixed(0)} KB)`);
