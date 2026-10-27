import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderResume, renderMarkdown, fmtDate, dateRange, inline } from '../public/render.js';
import { blockLabel } from '../public/schema.js';

const byId = new Map(
  Object.entries({
    h: { id: 'h', type: 'header', name: 'Ada <Lovelace>', email: 'ada@example.com', links: [{ label: 'Site', url: 'example.com' }] },
    e: {
      id: 'e',
      type: 'experience',
      role: 'Analyst',
      org: 'Acme',
      start: '2025-06',
      end: 'present',
      bullets: ['Did **A**', 'Did B', 'Did C'],
    },
    s: { id: 's', type: 'skills', label: 'Tools', items: ['Excel', 'SQL'] },
  }),
);

const comp = {
  header: 'h',
  sections: [
    { title: 'Experience', items: [{ block: 'e', hide: ['Did B'] }] },
    { title: 'Skills', items: [{ block: 's' }] },
    { title: 'Empty', items: [{ block: 'missing' }] },
  ],
};

test('dates', () => {
  assert.equal(fmtDate('2025-06'), 'Jun 2025');
  assert.equal(fmtDate('Present'), 'Present');
  assert.equal(fmtDate(2024), '2024');
  assert.equal(fmtDate('Summer 2024'), 'Summer 2024');
  assert.equal(dateRange('2025-06', 'present'), 'Jun 2025 – Present');
  assert.equal(dateRange('', '2026-05'), 'May 2026');
});

test('inline markup is escaped and limited', () => {
  assert.equal(inline('**x** <b>'), '<strong>x</strong> &lt;b&gt;');
  assert.equal(inline('[a](https://x.io)'), '<a href="https://x.io">a</a>');
  assert.equal(inline('[a](javascript:alert(1))'), '[a](javascript:alert(1))');
});

test('renderResume: escapes, hides bullets, skips empty sections', () => {
  const html = renderResume(comp, byId);
  assert.match(html, /Ada &lt;Lovelace&gt;/);
  assert.match(html, /<strong>A<\/strong>/);
  assert.doesNotMatch(html, /Did B/);
  assert.match(html, /Did C/);
  assert.match(html, /Jun 2025 – Present/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /Empty/);
});

test('renderMarkdown', () => {
  const md = renderMarkdown(comp, byId);
  assert.match(md, /^# Ada <Lovelace>/);
  assert.match(md, /## Experience/);
  assert.match(md, /\*\*Tools:\*\* Excel, SQL/);
  assert.doesNotMatch(md, /Did B/);
});

test('blockLabel', () => {
  assert.equal(blockLabel(byId.get('e')), 'Analyst · Acme');
  assert.equal(blockLabel({ type: 'experience', title: 'Custom' }), 'Custom');
});

test('a section title is kept with its first entry (no stranded headings at a page break)', async () => {
  const { renderResume } = await import('../public/render.js');
  const byId = new Map([
    ['a', { id: 'a', type: 'experience', role: 'Analyst', org: 'One', bullets: ['x'] }],
    ['b', { id: 'b', type: 'experience', role: 'Intern', org: 'Two', bullets: ['y'] }],
  ]);
  const html = renderResume({ sections: [{ title: 'Experience', items: [{ block: 'a' }, { block: 'b' }] }] }, byId);
  assert.match(html, /<div class="sec-lead"><h2>Experience<\/h2><div class="entry[^"]*">[\s\S]*?One/);
  assert.equal((html.match(/class="sec-lead"/g) || []).length, 1);
  assert.ok(html.indexOf('Two') > html.indexOf('</div></div>') || html.includes('Two'));
});
