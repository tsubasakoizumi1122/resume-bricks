#!/usr/bin/env node
// Builds docs/samples/: every resume in sample-data/ as a PDF and a PNG, so the
// README can show finished resumes. Rendering uses public/render.js, the same
// code as the app's preview. Needs Google Chrome (or set CHROME=/path/to/chrome).
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { renderResume, esc } from '../public/render.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'samples');

const CHROME = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p));
if (!CHROME) {
  console.error('Google Chrome not found. Set CHROME=/path/to/chrome and try again.');
  process.exit(1);
}

async function readKind(kind) {
  const dir = path.join(ROOT, 'sample-data', kind);
  const out = new Map();
  for (const f of (await fs.readdir(dir)).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    out.set(f.replace(/\.ya?ml$/, ''), YAML.parse(await fs.readFile(path.join(dir, f), 'utf8')));
  }
  return out;
}

const css = await fs.readFile(path.join(ROOT, 'public', 'resume.css'), 'utf8');
const byId = await readKind('blocks');
const resumes = await readKind('resumes');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-bricks-'));
await fs.mkdir(OUT, { recursive: true });

for (const [id, comp] of resumes) {
  const s = { theme: 'classic', paper: 'letter', accent: '#1f4e79', fontScale: 1, ...comp.settings };
  const size = s.paper === 'a4' ? { css: 'A4', w: 794, h: 1123 } : { css: 'letter', w: 816, h: 1056 };
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(comp.name)}</title>
<style>${css}
@page { size: ${size.css}; margin: 0; }
html, body { margin: 0; background: #fff; }</style></head><body>
<div class="resume theme-${esc(s.theme)} paper-${esc(s.paper)}" style="--accent:${esc(s.accent)};--fs:${Number(s.fontScale) || 1}">${renderResume(comp, byId)}</div>
</body></html>`;
  const src = path.join(tmp, `${id}.html`);
  await fs.writeFile(src, html);
  const url = `file://${src}`;
  const common = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-pdf-header-footer'];
  execFileSync(CHROME, [...common, `--print-to-pdf=${path.join(OUT, `${id}.pdf`)}`, url], { stdio: 'ignore' });
  execFileSync(CHROME, [...common, '--force-device-scale-factor=2', `--window-size=${size.w},${size.h}`, `--screenshot=${path.join(OUT, `${id}.png`)}`, url], { stdio: 'ignore' });
  console.log(`docs/samples/${id}.pdf, .png  (${comp.name})`);
}

await fs.rm(tmp, { recursive: true, force: true });
