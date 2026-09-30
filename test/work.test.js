import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkPrompt, parseClaudeReply, cleanBrick } from '../public/work.js';

test('prompt carries the rules, my context, style examples and the material', () => {
  const p = buildWorkPrompt({
    sources: [{ label: 'deck.pptx', kind: 'PowerPoint', text: 'Filtered 12,000 parcels' }],
    about: { name: 'Parcel screen', role: 'Solo analyst', target: 'real estate development analyst' },
    examples: ['Built an EPA TRI layer and a 500 m contamination buffer'],
    existing: ['Bike Route Planner'],
  });
  assert.match(p, /Never invent numbers/);
  assert.match(p, /proposal, plan or design that was not carried out/);
  assert.match(p, /roles like: real estate development analyst/);
  assert.match(p, /- My role: Solo analyst/);
  assert.match(p, /### Source 1: deck\.pptx \(PowerPoint\)\nFiltered 12,000 parcels/);
  assert.match(p, /My writing style[\s\S]*500 m contamination buffer/);
  assert.match(p, /don't repeat these\)\n- Bike Route Planner/);
  assert.match(p, /"bricks": \[/);
});

test('long material is cut to keep the prompt a sensible size', () => {
  const big = 'x'.repeat(200000);
  const p = buildWorkPrompt({ sources: [{ label: 'a', text: big }, { label: 'b', text: big }] });
  assert.ok(p.length < 100000);
  assert.match(p, /the rest was cut/);
});

test('reply in a code fence with prose around it and a trailing comma', () => {
  const reply = `Here are your bricks!

\`\`\`json
{
  "bricks": [
    { "type": "project", "name": "Chula Vista Parcel Screen", "start": "2026-06", "end": "2026-07",
      "bullets": ["Screened 12,000 parcels by zoning, size and transit access.", "Shortlisted 14 sites"], "tags": ["GIS", "Real Estate"], "extra": "dropped" },
    { "type": "skills", "label": "GIS", "items": ["QGIS", "TCAC opportunity maps"] },
  ],
  "questions": ["How many of the 14 sites were later pursued?"]
}
\`\`\`
Let me know if you want changes.`;
  const { bricks, questions } = parseClaudeReply(reply);
  assert.equal(bricks.length, 2);
  assert.deepEqual(bricks[0], {
    type: 'project',
    name: 'Chula Vista Parcel Screen',
    start: '2026-06',
    end: '2026-07',
    bullets: ['Screened 12,000 parcels by zoning, size and transit access', 'Shortlisted 14 sites'],
    tags: ['gis', 'real-estate', 'from-work'],
  });
  assert.deepEqual(bricks[1].items, ['QGIS', 'TCAC opportunity maps']);
  assert.deepEqual(questions, ['How many of the 14 sites were later pursued?']);
});

test('unknown types become projects; empty or broken replies explain what to do', () => {
  assert.equal(cleanBrick({ type: 'paper', title: 'Riverfront trail brief', bullets: ['Interviewed staff'] }).type, 'project');
  assert.equal(cleanBrick({ type: 'paper', title: 'Riverfront trail brief', bullets: ['x'] }).name, 'Riverfront trail brief');
  assert.throws(() => parseClaudeReply('Sorry, I cannot help.'), /No JSON found/);
  assert.throws(() => parseClaudeReply('{"bricks": [}'), /could not be read/);
  assert.throws(() => parseClaudeReply('{"bricks": []}'), /no bricks/);
});
