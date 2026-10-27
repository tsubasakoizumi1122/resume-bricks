import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseResume, takeDates, splitList, isSectionHeading, sectionType, fragments } from '../public/importer.js';
import { fileToText } from '../lib/extract.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pick = (b) => Object.fromEntries(Object.entries(b).filter(([k]) => !['tags', 'bullets', 'type'].includes(k)));

test('dates in many formats', () => {
  assert.deepEqual(takeDates('Analyst | Jun 2025 – Present').start, '2025-06');
  assert.equal(takeDates('Analyst | Jun 2025 – Present').end, 'present');
  assert.equal(takeDates('Sept. 2023 - May 2026').start, '2023-09');
  assert.equal(takeDates('06/2024 to 08/2024').end, '2024-08');
  assert.equal(takeDates('Summer 2025').end, 'Summer 2025');
  assert.equal(takeDates('Expected May 2027').end, '2027-05');
  assert.equal(takeDates('Built a 120-unit project').end, '', 'numbers in prose are not dates');
});

test('headings, types and list splitting', () => {
  assert.ok(isSectionHeading('EXPERIENCE & LEADERSHIP'));
  assert.ok(isSectionHeading('Work Experience:'));
  assert.ok(!isSectionHeading('Built a pro forma'));
  assert.equal(sectionType('Research & Analysis Projects'), 'project');
  assert.equal(sectionType('Certifications & Additional'), 'certification');
  assert.equal(sectionType('Honors and Awards'), 'award');
  assert.deepEqual(splitList('Excel (pro forma, DCF), SQL; Python'), ['Excel (pro forma, DCF)', 'SQL', 'Python']);
  assert.deepEqual(fragments('Org (fictional) | San Diego, CA'), ['Org (fictional)', 'San Diego, CA']);
});

test('pasted text with bullet markers and wrapped lines', () => {
  const r = parseResume(`Kenji Sato
kenji@example.com | (555) 222-3333 | Seattle, WA

EXPERIENCE
Acme Realty | Seattle, WA
Leasing Intern | Jun 2024 – Aug 2024
• Toured 40+ prospective residents and processed
  applications for a 300-unit tower
• Updated the rent roll weekly

SKILLS
Excel, Yardi, Japanese (native)`);
  assert.equal(r.header.name, 'Kenji Sato');
  assert.equal(r.header.location, 'Seattle, WA');
  const exp = r.sections[0].blocks[0];
  assert.deepEqual(pick(exp), { role: 'Leasing Intern', org: 'Acme Realty', location: 'Seattle, WA', start: '2024-06', end: '2024-08' });
  assert.equal(exp.bullets.length, 2);
  assert.match(exp.bullets[0], /processed applications for a 300-unit tower$/);
  assert.deepEqual(r.sections[1].blocks[0].items, ['Excel', 'Yardi', 'Japanese (native)']);
  assert.ok(r.sections.every((s) => s.blocks.every((b) => b.tags.includes('imported'))));
});

test('Word file: role-first lines and trailing locations', async () => {
  const text = await fileToText(await readFile(path.join(HERE, 'fixtures/alex-morgan.docx')), 'alex-morgan.docx');
  const r = parseResume(text);
  assert.equal(r.header.email, 'alex.morgan@example.com');
  const [a, b] = r.sections.find((s) => s.type === 'experience').blocks;
  assert.deepEqual(pick(a), { role: 'Research Assistant', org: 'Pacific Land Advisors', location: 'Los Angeles, CA', start: '2024-01', end: 'present' });
  assert.deepEqual(pick(b), { role: 'Leasing Associate', org: 'Sunset Property Group', location: 'Pasadena, CA', start: '2022-06', end: '2023-12' });
  const edu = r.sections.find((s) => s.type === 'education').blocks[0];
  assert.equal(edu.school, 'University of Southern California');
  assert.equal(edu.degree, 'Bachelor of Science in Real Estate Development');
  const cert = r.sections.find((s) => s.type === 'certification').blocks[0];
  assert.deepEqual(pick(cert), { name: 'Real Estate Salesperson License', issuer: 'California DRE', date: '2023' });
});

test('PDF printed by this app round-trips into the same bricks', async () => {
  const text = await fileToText(await readFile(path.join(HERE, 'fixtures/jordan-rivera.pdf')), 'jordan-rivera.pdf');
  const r = parseResume(text);
  assert.equal(r.header.name, 'Jordan Rivera');
  const types = r.sections.map((s) => s.type);
  assert.deepEqual(types, ['summary', 'experience', 'project', 'education', 'skills', 'certification']);
  const exp = r.sections[1].blocks;
  assert.equal(exp.length, 2);
  assert.equal(exp[0].org, 'Harbor & Pine Development (fictional)');
  assert.equal(exp[0].bullets.length, 4);
  assert.equal(r.sections[2].blocks[0].link, 'github.com/example/tod-suitability');
});

test('title-first layout with subtitles and short last bullets', () => {
  const r = parseResume(`Taro Yamada
taro@example.com | Portland, OR
EDUCATION
Lakeside State University | Portland, OR
Bachelor of Arts in Geography | May 2022
Honors in the Major
RESEARCH & ANALYSIS PROJECTS
Riverfront Trail Study | Summer 2021
Example City, Oregon
Interviewed city staff about trail maintenance
Summarized findings in a research brief
Bike Network Proposal | Spring 2021
Drafted a 10-year bike network plan
EXPERIENCE & LEADERSHIP
Northwind Media | Oregon (Remote)
Communications Intern | Feb 2021 – Aug 2021
Wrote and edited articles for the company blog
City Arena | Portland, OR
Event Staff | Jun 2020 – Aug 2021
Managed crowd flow at sold-out events`);
  const [edu, proj, exp] = r.sections;
  assert.equal(edu.blocks[0].degree, 'Bachelor of Arts in Geography');
  assert.deepEqual(edu.blocks[0].bullets, ['Honors in the Major']);
  assert.equal(proj.blocks.length, 2);
  assert.equal(proj.blocks[0].role, 'Example City, Oregon');
  assert.equal(proj.blocks[0].bullets.length, 2, 'a short last bullet stays a bullet');
  assert.equal(proj.blocks[1].name, 'Bike Network Proposal');
  assert.deepEqual(exp.blocks.map(pick), [
    { role: 'Communications Intern', org: 'Northwind Media', location: 'Oregon (Remote)', start: '2021-02', end: '2021-08' },
    { role: 'Event Staff', org: 'City Arena', location: 'Portland, OR', start: '2020-06', end: '2021-08' },
  ]);
});

test('a place with a work mode is a location, not part of the role', () => {
  for (const loc of ['Oregon (Remote)', 'Canada (Hybrid)', 'New Zealand (On-site)', 'Japan (Remote)']) {
    const r = parseResume(`A B\na@example.com\nEXPERIENCE\nNorthwind Media | ${loc}\nCommunications Intern | Feb 2021 – Aug 2021\nWrote articles`);
    const b = r.sections[0].blocks[0];
    assert.deepEqual([b.org, b.role, b.location], ['Northwind Media', 'Communications Intern', loc], loc);
  }
});

test('images and other binary files are refused instead of becoming bricks', async () => {
  const { fileToText } = await import('../lib/extract.js');
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 400 }, (_, i) => i % 256)]);
  await assert.rejects(fileToText(png, 'photo.png', 'image/png'), /not supported/);
  assert.equal(await fileToText(new TextEncoder().encode('Jane Doe\nEXPERIENCE\nAnalyst | Acme'), 'resume.txt'), 'Jane Doe\nEXPERIENCE\nAnalyst | Acme');
});
