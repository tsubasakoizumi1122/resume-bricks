// Hidden bullets must stay hidden when a brick's bullets are edited (review, 2026-10-25).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignBullets, remapHidden, remapResume } from '../public/hide.js';
import { visibleBullets } from '../public/render.js';

const before = ['Managed email campaigns in HubSpot', 'Built weekly reports in Excel'];

test('rewording a hidden bullet keeps it hidden (the reported bug)', () => {
  const after = ['Managed email campaigns using HubSpot', 'Built weekly reports in Excel'];
  const hide = remapHidden(before, after, ['Managed email campaigns in HubSpot']);
  assert.deepEqual(hide, ['Managed email campaigns using HubSpot']);
  assert.deepEqual(visibleBullets({ bullets: after }, { hide }), ['Built weekly reports in Excel']);
});

test('insert, delete and reorder keep each choice on its own line', () => {
  const old = ['A', 'B', 'C', 'D'];
  assert.deepEqual(remapHidden(old, ['A', 'new', 'B', 'C', 'D'], ['B']), ['B'], 'insert above');
  assert.deepEqual(remapHidden(old, ['A', 'C', 'D'], ['B', 'C']), ['C'], 'hidden line deleted: its choice goes away');
  assert.deepEqual(remapHidden(old, ['D', 'C', 'B', 'A'], ['B']), ['B'], 'reordered');
  assert.deepEqual(remapHidden(old, ['A', 'B2', 'C', 'D'], ['B']), ['B2'], 'reworded in place');
  assert.deepEqual(remapHidden(old, ['A', 'B2', 'C2', 'D'], ['C']), ['C2'], 'two lines reworded at once');
  assert.deepEqual(remapHidden(old, old, []), []);
});

test('alignment pairs edited lines between unchanged ones', () => {
  assert.deepEqual(alignBullets(['A', 'B', 'C'], ['A', 'X', 'C']), [0, 1, 2]);
  assert.deepEqual(alignBullets(['A', 'B', 'C'], ['A', 'C']), [0, -1, 1]);
});

test('each resume keeps its own selection after one shared edit', () => {
  const after = ['Managed email campaigns using HubSpot', 'Built weekly reports in Excel'];
  const r1 = { sections: [{ title: 'Experience', items: [{ block: 'exp', hide: ['Managed email campaigns in HubSpot'] }] }] };
  const r2 = { sections: [{ title: 'Experience', items: [{ block: 'exp', hide: ['Built weekly reports in Excel'] }, { block: 'other', hide: ['x'] }] }] };
  const r3 = { sections: [{ title: 'Experience', items: [{ block: 'exp' }] }] };
  assert.deepEqual(remapResume(r1, 'exp', before, after).sections[0].items[0].hide, ['Managed email campaigns using HubSpot']);
  assert.equal(remapResume(r2, 'exp', before, after), null, 'an untouched hidden line needs no change');
  assert.equal(remapResume(r3, 'exp', before, after), null);
  const gone = remapResume(r1, 'exp', before, ['Built weekly reports in Excel']);
  assert.equal(gone.sections[0].items[0].hide, undefined, 'deleted hidden line leaves no stale entry');
});
