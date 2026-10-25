// docs/demo.html inlines public/*.js without a bundler: make sure nothing app.js imports is left out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the demo contains everything app.js imports', () => {
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const demo = readFileSync(path.join(ROOT, 'docs', 'demo.html'), 'utf8');
  const names = [...app.matchAll(/^import \{([^}]+)\} from '\.\/[\w.-]+\.js';$/gm)].flatMap((m) => m[1].split(',').map((x) => x.trim()));
  assert.ok(names.length > 5);
  const missing = names.filter((n) => !new RegExp(`(function|const|let|class) ${n}\\b`).test(demo));
  assert.deepEqual(missing, [], 'run npm run build:demo after adding a module');
});

test('public modules share no top-level names (the demo puts them in one scope)', () => {
  const seen = new Map();
  const clash = [];
  for (const f of ['schema.js', 'render.js', 'importer.js', 'work.js', 'hide.js', 'tour.js', 'vocab.js', 'tailor.js', 'app.js']) {
    const src = readFileSync(path.join(ROOT, 'public', f), 'utf8');
    for (const [, name] of src.matchAll(/^(?:export )?(?:const|let|function|class|async function) ([A-Za-z_$][\w$]*)/gm)) {
      if (seen.has(name)) clash.push(`${name} (${seen.get(name)}, ${f})`);
      else seen.set(name, f);
    }
  }
  assert.deepEqual(clash, []);
});
