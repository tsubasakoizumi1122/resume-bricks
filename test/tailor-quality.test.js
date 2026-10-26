// Tailor quality fixes from hands-on review (2026-10-25).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeJob, orGroups, tailorResume, hiddenByScore } from '../public/tailor.js';

const jordan = [
  { id: 'h', type: 'header', name: 'Jordan Rivera' },
  { id: 'exp', type: 'experience', role: 'Development Analyst Intern', org: 'Harbor & Pine', end: '2025-09',
    bullets: ['Built a pro forma for a multifamily project in Excel', 'Screened infill parcels for zoning capacity', 'Pulled rent comps for underwriting', 'Prepared investment committee memos'] },
  { id: 'sk', type: 'skills', label: 'Languages', items: ['English (native)', 'Spanish (fluent)'] },
  { id: 'tools', type: 'skills', label: 'Technical', items: ['Excel', 'ArcGIS Pro', 'Python'] },
];
const job = `Development Analyst - Pacific Urban Partners
Build pro forma models in Excel and ARGUS, underwrite acquisitions, track entitlements, prepare investment committee memos.
Spanish or Japanese a plus. ARGUS Enterprise preferred.`;

test('either/or requirements: one option you have is enough', () => {
  const { missing } = analyzeJob(job, jordan);
  assert.ok(!missing.includes('japanese'), `missing: ${missing}`);
  assert.ok(missing.includes('argus'), 'a real gap is still reported');
  assert.equal(orGroups('Spanish or Japanese a plus.').length, 1);
  assert.equal(orGroups('Experience with leasing, asset management, and development across the western United States or similar markets.').length, 0, 'long clauses are not option lists');
});

test('covered terms lead with real skills, not everyday words', () => {
  const { matched } = analyzeJob(job, jordan);
  assert.ok(matched.length <= 10);
  for (const plain of ['track', 'committee']) assert.ok(!matched.includes(plain), `${plain} in ${matched}`);
  assert.ok(matched.includes('excel'));
});

test('hidden bullets are offered back best match first', () => {
  const { comp, report } = tailorResume({ jobText: job, bricks: jordan, name: 'x' });
  const exp = comp.sections.flatMap((s) => s.items).find((it) => it.block === 'exp');
  assert.equal(exp.hide.length, 1, 'tailoring keeps 3 of 4 bullets at first');
  const back = hiddenByScore(comp, report.scores);
  assert.equal(back.length, 1);
  assert.equal(back[0].text, exp.hide[0]);
});
