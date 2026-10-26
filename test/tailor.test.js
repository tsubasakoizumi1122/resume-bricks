import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concepts, analyzeJob, tailorResume, trimOnce, buildTailorPrompt, applyTailorReply, dateKey } from '../public/tailor.js';

const bricks = [
  { id: 'header-me', type: 'header', name: 'Test Person' },
  { id: 'sum-plan', type: 'summary', text: 'Urban planning student with GIS and community engagement experience' },
  { id: 'sum-re', type: 'summary', tags: ['target'], text: 'Real estate student focused on pro forma modeling and site analysis' },
  { id: 'edu', type: 'education', school: 'State University', degree: 'BA Urban Studies', end: '2027-05' },
  {
    id: 'exp-dev', type: 'experience', role: 'Development Intern', org: 'Pine Co', start: '2025-06', end: '2025-08',
    bullets: [
      'Built a pro forma for a multifamily project in Excel',
      'Screened infill parcels for zoning capacity',
      'Organized the team lunch calendar',
      'Prepared market research memos on rents',
    ],
  },
  { id: 'exp-cafe', type: 'experience', role: 'Barista', org: 'Cafe', start: '2023-01', end: '2024-01', bullets: ['Served customers', 'Trained new staff', 'Closed the store'] },
  { id: 'exp-event', type: 'experience', role: 'Event Staff', org: 'Stadium', start: '2024-03', end: 'present', bullets: ['Guided guests at events', 'Handled crowd flow'] },
  { id: 'proj-gis', type: 'project', name: 'Parcel GIS map', end: '2025-12', bullets: ['Mapped parcels in ArcGIS', 'Joined census data', 'Presented to class'] },
  { id: 'proj-poem', type: 'project', name: 'Poetry zine', end: '2022-05', bullets: ['Edited poems', 'Printed copies'] },
  { id: 'sk-tools', type: 'skills', label: 'Tools', items: ['Excel', 'ArcGIS', 'R'] },
  { id: 'sk-lang', type: 'skills', label: 'Languages', items: ['Japanese', 'English'] },
];

const job = `Real Estate Development Intern
Support acquisitions with pro forma underwriting in Excel and ARGUS.
Conduct market research and site analysis for multifamily projects. Zoning review. SQL a plus.`;

test('concepts merges phrases and expands synonyms', () => {
  const c = concepts('Real estate pro forma using ArcGIS spreadsheets');
  assert.ok(c.includes('realestate'));
  assert.ok(c.includes('proforma'));
  assert.ok(c.includes('financialmodel'));
  assert.ok(c.includes('gis'));
  assert.ok(c.includes('excel'));
});

test('analyzeJob finds matched and missing terms', () => {
  const a = analyzeJob(job, bricks);
  assert.ok(a.matched.includes('proforma') || a.matched.includes('financialmodel'));
  assert.ok(a.missing.includes('argus'));
  assert.ok(a.missing.includes('sql'));
  assert.ok(!a.missing.includes('excel'));
  const dev = a.scored.find((s) => s.id === 'exp-dev');
  const cafe = a.scored.find((s) => s.id === 'exp-cafe');
  assert.ok(dev.score > cafe.score);
});

test('tailorResume picks relevant bricks, the right summary, and hides weak bullets', () => {
  const { comp, report } = tailorResume({ jobText: job, bricks, base: { settings: { theme: 'modern' } }, name: 'X' });
  assert.equal(comp.header, 'header-me');
  assert.equal(comp.settings.theme, 'modern');
  const sec = (t) => comp.sections.find((s) => s.title === t);
  assert.deepEqual(sec('Summary').items, [{ block: 'sum-re' }]);
  assert.equal(sec('Education').items[0].block, 'edu');
  const exp = sec('Experience').items;
  assert.ok(exp.some((it) => it.block === 'exp-dev'));
  const dev = exp.find((it) => it.block === 'exp-dev');
  assert.deepEqual(dev.hide, ['Organized the team lunch calendar']);
  assert.ok(exp.length >= 2, 'keeps a floor of experience');
  assert.ok(!sec('Projects').items.some((it) => it.block === 'proj-poem') || sec('Projects').items.length <= 2);
  assert.ok(comp.job.missing.includes('argus'));
  assert.ok(report.scores instanceof Map);
});

test('trimOnce hides bullets first, then drops weak bricks, then stops', () => {
  const { comp, report } = tailorResume({ jobText: job, bricks, name: 'X' });
  let n = 0;
  while (trimOnce(comp, report.scores) && n < 100) n++;
  assert.ok(n < 100);
  for (const s of comp.sections) {
    for (const it of s.items) {
      const b = bricks.find((x) => x.id === it.block);
      const shown = (b.bullets || []).filter((x) => !(it.hide || []).includes(x));
      if ((b.bullets || []).length >= 2) assert.ok(shown.length >= 2);
    }
  }
  assert.ok(comp.sections.find((s) => s.title === 'Experience').items.length >= 1);
  assert.ok(comp.sections.find((s) => s.title === 'Summary'));
});

test('buildTailorPrompt lists ids and bullet numbers, applyTailorReply maps them back', () => {
  const { comp } = tailorResume({ jobText: job, bricks, name: 'X' });
  const prompt = buildTailorPrompt({ jobText: job, bricks, comp });
  assert.match(prompt, /"id": "exp-dev"/);
  assert.match(prompt, /0: Built a pro forma/);
  const reply = '```json\n{"sections":[{"title":"Experience","items":[{"id":"exp-dev","bullets":[0,1,99]},{"id":"made-up"}]},{"title":"Header","items":["header-me"]}],"why":"Dev first","gaps":["ARGUS"]}\n```';
  const res = applyTailorReply(reply, bricks, comp);
  assert.equal(res.comp.header, 'header-me');
  assert.equal(res.comp.sections.length, 1);
  assert.deepEqual(res.comp.sections[0].items[0].hide, ['Organized the team lunch calendar', 'Prepared market research memos on rents']);
  assert.deepEqual(res.skipped, ['made-up', 'header-me']);
  assert.deepEqual(res.gaps, ['ARGUS']);
  assert.throws(() => applyTailorReply('{"sections":[{"items":["nope"]}]}', bricks, comp), /no bricks/);
});

test('dateKey orders present, months and seasons', () => {
  assert.ok(dateKey({ end: 'present' }) > dateKey({ end: '2026-01' }));
  assert.ok(dateKey({ end: 'Fall 2025' }) > dateKey({ end: '2025-06' }));
  assert.equal(dateKey({}), 0);
});

test('variants of the same job are not both picked', () => {
  const extra = [...bricks, { id: 'exp-dev-2', type: 'experience', role: 'Development Intern (variant)', org: 'Pine Co', end: '2025-08', bullets: ['Built pro forma models in Excel for multifamily', 'Reviewed zoning'] }];
  const { comp } = tailorResume({ jobText: job, bricks: extra, name: 'X' });
  const ids = comp.sections.find((s) => s.title === 'Experience').items.map((it) => it.block);
  assert.equal(ids.filter((id) => id.startsWith('exp-dev')).length, 1);
});

test('education leads for students, follows experience for everyone else', () => {
  const titles = (edEnd) => {
    const bs = bricks.map((b) => (b.id === 'edu' ? { ...b, end: edEnd } : b));
    return tailorResume({ jobText: job, bricks: bs, today: new Date(2026, 8, 1) }).comp.sections.map((s) => s.title);
  };
  const before = (t, a, b) => t.indexOf(a) < t.indexOf(b);
  assert.ok(before(titles('2027-05'), 'Education', 'Experience'), 'still studying');
  assert.ok(before(titles('2026-05'), 'Education', 'Experience'), 'graduated this year');
  assert.ok(before(titles('2021-05'), 'Experience', 'Education'), 'graduated years ago');
});

test('marketing terms are recognized, and missing tools are flagged', () => {
  const mk = [
    { id: 'exp-mk', type: 'experience', role: 'Marketing Manager', org: 'SaaS Co', end: 'present', bullets: ['Ran paid search and paid social in Google Ads and Meta', 'Built lifecycle email in HubSpot', 'Ran A/B tests on landing pages'] },
    { id: 'exp-shop', type: 'experience', role: 'Cashier', org: 'Shop', end: '2019-01', bullets: ['Ran the register'] },
  ];
  const a = analyzeJob('Growth marketer for PPC, social ads, split testing and email marketing. Marketo or HubSpot. Google Analytics required.', mk);
  for (const c of ['paidsearch', 'paidsocial', 'abtest', 'email', 'hubspot']) assert.ok(a.matched.includes(c), c);
  assert.ok(!a.missing.includes('marketo'), '"Marketo or HubSpot": HubSpot is enough');
  assert.ok(a.missing.includes('googleanalytics'));
  assert.ok(a.scored.find((s) => s.id === 'exp-mk').score > a.scored.find((s) => s.id === 'exp-shop').score);
});
