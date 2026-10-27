// The web build tags its files with one build id, so a browser never pairs a cached page with new code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'app');

test('index.html and the code carry the same build id', () => {
  const html = readFileSync(path.join(APP, 'index.html'), 'utf8');
  const id = html.match(/<meta name="rb-build" content="([0-9a-f]{10})"/)?.[1];
  assert.ok(id, 'run npm run build:web');
  for (const f of ['app.js', 'styles.css', 'resume.css', 'theme.css']) assert.ok(html.includes(`${f}?v=${id}`), f);
  assert.ok(readFileSync(path.join(APP, 'app.js'), 'utf8').includes(id), 'app.js knows its build id');
});
