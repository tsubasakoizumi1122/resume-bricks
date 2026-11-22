// Web-only feedback link and anonymous counts: what is sent, and when nothing is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countUrl, trackingAllowed, campaignQuery, STEPS, isFeedbackLink } from '../web/telemetry.js';

test('the app\'s "Send feedback" links are recognised (so the web version can open the form)', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter(isFeedbackLink);
  assert.ok(hrefs.length >= 1, 'public/index.html has a Send feedback link');
  assert.equal(isFeedbackLink('https://github.com/tsubasakoizumi1122/resume-bricks'), false);
  assert.equal(isFeedbackLink(''), false);
});
import * as config from '../web/config.js';

test('counting is skipped on Do Not Track, Global Privacy Control and local hosts', () => {
  const web = { hostname: 'tsubasakoizumi1122.github.io' };
  assert.equal(trackingAllowed({}, web), true);
  assert.equal(trackingAllowed({ doNotTrack: '1' }, web), false);
  assert.equal(trackingAllowed({ globalPrivacyControl: true }, web), false);
  for (const hostname of ['localhost', '127.0.0.1', '', 'mac.local']) assert.equal(trackingAllowed({}, { hostname }), false);
});

test('a hit carries only the step, referrer and campaign tag', () => {
  const u = new URL(countUrl('resumebricks', { path: 'pdf', title: 'pdf', event: true }));
  assert.equal(u.host, 'resumebricks.goatcounter.com');
  assert.equal(u.searchParams.get('p'), 'pdf');
  assert.equal(u.searchParams.get('e'), 'true');
  assert.deepEqual([...u.searchParams.keys()].sort(), ['e', 'p', 'rnd', 't']);

  const v = new URL(countUrl('resumebricks', { path: '/app', title: 'Resume Bricks', referrer: 'https://www.reddit.com/', query: '?ref=reddit' }));
  assert.equal(v.searchParams.get('r'), 'https://www.reddit.com/');
  assert.equal(v.searchParams.get('q'), '?ref=reddit');
  assert.equal(v.searchParams.get('e'), null);
});

test('a bad or empty site code sends nothing', () => {
  assert.equal(countUrl('', { path: '/app' }), null);
  assert.equal(countUrl('evil.com/x?', { path: '/app' }), null);
});

test('only campaign tags are kept from the address', () => {
  assert.equal(campaignQuery('?ref=reddit&name=Jordan'), '?ref=reddit');
  assert.equal(campaignQuery('?utm_source=linkedin&utm_campaign=launch'), '?utm_source=linkedin&utm_campaign=launch');
  assert.equal(campaignQuery('?q=secret'), '');
  assert.equal(campaignQuery(''), '');
});

test('every counted button exists in the page', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const id of Object.keys(STEPS)) assert.ok(html.includes(`id="${id}"`), id);
});

test('config values are strings (empty means off)', () => {
  assert.equal(typeof config.FEEDBACK_URL, 'string');
  assert.equal(typeof config.GOATCOUNTER, 'string');
});
