// Fixes from hands-on feedback (2026-10): sample data mixing into tailoring,
// and company names turning into "missing skills".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { ownBricks, stripOrgNames, analyzeJob, tailorResume, buildTailorPrompt, applyTailorReply } from '../public/tailor.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every bundled sample file is marked sample: true', () => {
  for (const kind of ['blocks', 'resumes']) {
    const dir = path.join(ROOT, 'sample-data', kind);
    for (const f of readdirSync(dir)) {
      const doc = YAML.parse(readFileSync(path.join(dir, f), 'utf8'));
      assert.equal(doc.sample, true, `${kind}/${f}`);
    }
  }
});

const sample = [
  { id: 'header-main', type: 'header', name: 'Your Name', sample: true },
  { id: 'exp-sample', type: 'experience', role: 'Marketing Manager', org: 'Software Company', bullets: ['Ran SQL reports on paid search', 'Grew email list'], sample: true },
  { id: 'sum-growth', type: 'summary', text: 'Growth marketer who uses SQL and paid search', sample: true },
];
const mine = [
  { id: 'header-jordan', type: 'header', name: 'Jordan Rivera' },
  { id: 'exp-jordan', type: 'experience', role: 'Analyst', org: 'Northwind', bullets: ['Built Excel dashboards', 'Wrote weekly reports'] },
  { id: 'sum-jordan', type: 'summary', text: 'Analyst who builds Excel dashboards' },
];
const job = 'Marketing Analyst at Example Labs. Example Labs needs SQL, paid search and Excel dashboards. Weekly reports.';

test('ownBricks skips the sample person once you have bricks of your own', () => {
  assert.deepEqual(ownBricks([...sample, ...mine]).map((b) => b.id), ['header-jordan', 'exp-jordan', 'sum-jordan']);
  assert.equal(ownBricks(sample).length, 3, 'the demo (only samples) still works');
  assert.equal(ownBricks([{ id: 'x', type: '_error' }]).length, 0);
});

test('tailoring a new person never picks the sample career', () => {
  const { comp } = tailorResume({ jobText: job, bricks: [...sample, ...mine], name: 'Jordan for Example Labs' });
  const used = [comp.header, ...comp.sections.flatMap((s) => s.items.map((it) => it.block))];
  assert.equal(comp.header, 'header-jordan');
  assert.ok(!used.some((id) => sample.some((b) => b.id === id)), `used: ${used}`);
  const prompt = buildTailorPrompt({ jobText: job, bricks: [...sample, ...mine], comp });
  assert.ok(!prompt.includes('exp-sample'), 'the Claude prompt has no sample bricks either');
  const reply = JSON.stringify({ sections: [{ title: 'Experience', items: [{ id: 'exp-sample' }, { id: 'exp-jordan' }] }] });
  const res = applyTailorReply(reply, [...sample, ...mine], comp);
  assert.deepEqual(res.skipped, ['exp-sample']);
});

test('company names are not read as skills', () => {
  assert.equal(stripOrgNames('Join Example Labs today').includes('Labs'), false);
  assert.equal(stripOrgNames('Harbor & Pine, Inc. is hiring').includes('Pine'), false);
  assert.match(stripOrgNames('Wet Lab experience required'), /Lab experience/, 'a singular "Lab" in a sentence stays');
  assert.match(stripOrgNames('Requirements\nLab Techniques'), /Lab Techniques/, 'headings on their own line stay');
  const { missing } = analyzeJob(job, mine);
  assert.ok(!missing.some((m) => m.startsWith('lab')), `missing: ${missing}`);
  assert.ok(missing.includes('sql'), 'real gaps are still reported');
});

test('lab techniques still count when the job actually asks for them', () => {
  const { missing } = analyzeJob('Research assistant: wet lab work, PCR and cell culture. Laboratory techniques required.', mine);
  assert.ok(missing.includes('labtechniques'));
  const plain = analyzeJob('Work in our innovation lab on marketing campaigns.', mine);
  assert.ok(!plain.missing.some((m) => m.startsWith('lab')), 'the word "lab" alone is not a skill gap');
});
