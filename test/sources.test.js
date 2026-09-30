import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubToText, folderToText } from '../lib/sources.js';
import { fileToText } from '../lib/extract.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('PowerPoint: slide text and speaker notes in order', async () => {
  const t = await fileToText(await readFile(path.join(HERE, 'fixtures/sample-deck.pptx')), 'deck.pptx');
  assert.match(t, /--- Slide 1 ---\nChula Vista Affordable Housing Parcel Screen/);
  assert.match(t, /\[Speaker notes\] I built the parcel layer/);
  assert.ok(t.indexOf('Slide 1') < t.indexOf('Slide 2'));
  assert.match(t, /zoning, size & transit access/, 'entities are decoded');
});

test('folder: languages, layout and README, skipping node_modules', async () => {
  const { title, text } = await folderToText(path.join(HERE, '..'));
  assert.equal(title, 'resume-bricks');
  assert.match(text, /Languages \(by file count\): JavaScript/);
  assert.match(text, /### README\.md/);
  assert.doesNotMatch(text, /node_modules\//);
  await assert.rejects(folderToText('/no/such/folder'), { status: 404 });
});

test('GitHub: repo facts and README, with clear errors', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
    if (String(url).includes('missing')) return json({}, 404);
    if (String(url).endsWith('/readme')) return new Response('# Kabugotchi\nA pet that grows with a stock price.');
    if (String(url).endsWith('/languages')) return json({ TypeScript: 9000, CSS: 800 });
    return json({
      name: 'kabugotchi', full_name: 'me/kabugotchi', html_url: 'https://github.com/me/kabugotchi',
      description: 'Stock-powered virtual pet', topics: ['react'], created_at: '2026-08-01T00:00:00Z', pushed_at: '2026-08-25T00:00:00Z',
    });
  });
  const g = await githubToText('https://github.com/me/kabugotchi.git');
  assert.equal(g.link, 'https://github.com/me/kabugotchi');
  assert.match(g.text, /Description: Stock-powered virtual pet/);
  assert.match(g.text, /Languages: TypeScript, CSS/);
  assert.match(g.text, /Created: 2026-08-01 {2}Last push: 2026-08-25/);
  assert.match(g.text, /A pet that grows with a stock price/);
  assert.ok(calls[0].startsWith('https://api.github.com/repos/me/kabugotchi'));
  await assert.rejects(githubToText('https://github.com/me/missing'), /If it is private, add its folder/);
  await assert.rejects(githubToText('https://example.com/x'), { status: 400 });
});
