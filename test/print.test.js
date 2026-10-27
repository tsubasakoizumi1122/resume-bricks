// Print the real builder CSS, not just a standalone resume: responsive pane rules
// must never move the resume off the printed page when Library is selected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pdfToText } from '../lib/extract.js';

const chrome = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p));
test('builder prints the resume from Library on Letter and A4', { skip: !chrome, timeout: 60000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rb-print-regression-'));
  try {
    const css = (await Promise.all(['styles.css', 'resume.css', 'theme.css'].map(f => readFile(new URL('../public/' + f, import.meta.url), 'utf8')))).join('\n');
    for (const paper of ['letter', 'a4']) {
      const html = path.join(dir, paper + '.html');
      const pdf = path.join(dir, paper + '.pdf');
      await writeFile(html, `<!doctype html><html><head><style>${css}\n@page { size: ${paper === 'a4' ? 'A4' : 'letter'}; margin: 0.5in 0.6in; }</style></head><body data-pane="library"><header class="topbar">BUILDER_ONLY_SENTINEL</header><main class="workspace chrome"><aside class="pane library">LIBRARY_ONLY_SENTINEL</aside><section class="pane layout"></section><section class="pane preview-pane"><div class="pane-head">PREVIEW_CONTROLS_SENTINEL</div><div class="paper-wrap"><div id="page" class="resume theme-classic paper-${paper}"><h1>PRINT_BODY_SENTINEL</h1><p>Visible resume content</p></div></div></section></main></body></html>`);
      execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--user-data-dir=' + path.join(dir, 'profile'), '--print-to-pdf=' + pdf, pathToFileURL(html).href], { timeout: 25000, stdio: 'ignore' });
      const text = await pdfToText(await readFile(pdf));
      assert.match(text, /PRINT_BODY_SENTINEL/, paper + ': resume must be visible');
      assert.doesNotMatch(text, /BUILDER_ONLY_SENTINEL|LIBRARY_ONLY_SENTINEL|PREVIEW_CONTROLS_SENTINEL/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// A resume that fills one page in the preview must print on one page: the builder's screen spacing
// (workspace and pane padding) once narrowed the printed text to 90% and pushed it down, adding a page.
test('a page that fits in the preview prints on one page', { skip: !chrome, timeout: 60000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rb-print-fit-'));
  try {
    const css = (await Promise.all(['styles.css', 'resume.css', 'theme.css'].map(f => readFile(new URL('../public/' + f, import.meta.url), 'utf8')))).join('\n');
    for (const paper of ['letter', 'a4']) {
      const usable = paper === 'a4' ? '10.69in' : '10in'; // paper height minus the 0.5in top and bottom margins
      const html = path.join(dir, paper + '.html');
      const pdf = path.join(dir, paper + '.pdf');
      await writeFile(html, `<!doctype html><html><head><style>${css}\n@page { size: ${paper === 'a4' ? 'A4' : 'letter'}; margin: 0.5in 0.6in; }</style></head><body data-pane="preview"><header class="topbar">x</header><main class="workspace chrome"><aside class="pane library"></aside><section class="pane layout"></section><section class="pane preview-pane"><div class="pane-head">x</div><div class="paper-wrap"><div id="page" class="resume theme-classic paper-${paper}"><div style="height: calc(${usable} - 2px); width: 7.3in; outline: 1px solid #000"></div></div></div></section></main></body></html>`);
      execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--user-data-dir=' + path.join(dir, 'profile'), '--print-to-pdf=' + pdf, pathToFileURL(html).href], { timeout: 25000, stdio: 'ignore' });
      const pages = ((await readFile(pdf, 'latin1')).match(/\/Type\s*\/Page[^s]/g) || []).length;
      assert.equal(pages, 1, paper + ': a full page of content must print on exactly one page');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
