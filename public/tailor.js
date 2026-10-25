// "Tailor to a job": score bricks against a job post and assemble a resume from them.
// Pure functions (no DOM), shared by the browser and the tests. Nothing here writes new text:
// it only chooses bricks, orders them and picks which existing bullets to show.
import { TYPES, blockLabel } from './schema.js';
import { extractJson } from './work.js';
import { PHRASES, SYNONYMS, GAP_VOCAB, TERM_LABELS } from './vocab.js';

// ---------------------------------------------------------------- text -> concepts

const STOP = new Set(
  (
    'a an and are as at be been being but by can could do does for from had has have he her his how i if in into is it its ' +
    'may me more most must my no not of on or our out over per she should so such than that the their them then there these ' +
    'they this those through to under up us was we were what when where which while who will with within would you your ' +
    'ability able about across all also any apply applicant applicants candidate candidates company daily duties employer ' +
    'equal etc excellent experience experienced familiarity familiar field following good great ideal including job knowledge ' +
    'least like looking new one opportunity other others plus position preferred provide qualification qualifications ' +
    'related required requirement requirements responsibilities responsibility role skill skills strong team teams time ' +
    'understanding using various well work working year years benefits salary pay hour hours per week full part based ' +
    'successful seeking join help make take within via both each other day days assist assisting ensure support intern interns internship internships student students position opening apply team member members use used staff language languages'
  ).split(/\s+/),
);

// Tokens made by PHRASES are already whole concepts: never stem them.
const PROTECTED = new Set(PHRASES.flatMap(([, rep]) => rep.split(' ')));

export function stem(w) {
  if (w.length <= 3 || GAP_VOCAB.has(w) || PROTECTED.has(w) || SYNONYMS[w]) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('es') && w.length > 4 && /(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
  return w;
}

/** Text -> list of concept tokens (with repeats), synonyms expanded.
 *  Pass a Map as `surface` to learn how each stemmed token was written (for display). */
export function concepts(text, surface) {
  let t = ` ${String(text || '').toLowerCase()} `;
  for (const [re, rep] of PHRASES) t = t.replace(re, ` ${rep} `);
  const out = [];
  for (const raw of t.match(/[a-z][a-z0-9+#.]*[a-z0-9+#]|[a-z]/g) || []) {
    const w = raw.replace(/\.+$/, '');
    if (STOP.has(w) || (w.length < 2 && w !== 'r')) continue;
    const s = stem(w);
    if (STOP.has(s)) continue;
    out.push(s);
    if (surface && !surface.has(s)) surface.set(s, w);
    for (const c of SYNONYMS[w] || SYNONYMS[s] || []) if (c !== s) out.push(c);
  }
  return out;
}

const FIELDS = ['title', 'name', 'role', 'org', 'school', 'degree', 'label', 'heading', 'text', 'issuer', 'location'];
export function brickText(b) {
  const parts = FIELDS.map((f) => b[f]).filter(Boolean);
  for (const k of ['items', 'bullets', 'tags']) if (Array.isArray(b[k])) parts.push(b[k].join(' . '));
  return parts.join(' . ');
}

// ---------------------------------------------------------------- which bricks count

/** Bricks to tailor from: your own ones. The bundled sample person (sample: true) is only
 *  used when the library has nothing else in it, e.g. in the demo. */
export function ownBricks(bricks) {
  const usable = (bricks || []).filter((b) => b && b.type && b.type !== '_error');
  const own = usable.filter((b) => !b.sample);
  return own.length ? own : usable;
}

// Company names say nothing about the skills a job needs ("Example Labs" is not "lab techniques").
const ORG_SUFFIX =
  'Labs|Laboratories|Inc|Incorporated|LLC|L\\.L\\.C|Ltd|Limited|Corp|Corporation|Co|Company|GmbH|PLC|LLP|LP|K\\.K|Holdings|Ventures|Technologies|Studios?';
const ORG_RE = new RegExp(
  `\\b(?:(?:[A-Z][\\w'’-]*|&)\\.?[ \\t]+){1,4}(?:${ORG_SUFFIX})\\b\\.?`,
  'g',
);
/** Drop company names like "Example Labs" or "Harbor & Pine, Inc." from a job post before matching. */
export function stripOrgNames(text) {
  return String(text || '').replace(/,\s+(?=(?:Inc|LLC|Ltd|Corp)\b)/g, ' ').replace(ORG_RE, ' ');
}

// ---------------------------------------------------------------- scoring

/** Job post + bricks -> weights for the job's concepts and scores for every brick and bullet. */
export function analyzeJob(jobText, bricks) {
  jobText = stripOrgNames(jobText);
  const usable = bricks.filter((b) => b && b.type && b.type !== '_error');
  const docs = usable.map((b) => new Set(concepts(brickText(b))));
  const N = docs.length || 1;
  const df = new Map();
  for (const d of docs) for (const c of d) df.set(c, (df.get(c) || 0) + 1);

  const tf = new Map();
  const surface = new Map();
  for (const c of concepts(jobText, surface)) tf.set(c, (tf.get(c) || 0) + 1);
  const weights = new Map();
  for (const [c, n] of tf) {
    const idf = Math.log((N + 1) / ((df.get(c) || 0) + 1)) + 1;
    weights.set(c, Math.min(n, 4) * idf);
  }

  const scoreText = (text) => {
    const hits = new Map();
    for (const c of new Set(concepts(text))) if (weights.has(c)) hits.set(c, weights.get(c));
    const sum = [...hits.values()].reduce((a, v) => a + v, 0);
    return { score: sum, hits };
  };

  const scored = usable.map((b, i) => {
    const { score, hits } = scoreText(brickText(b));
    const size = docs[i].size;
    const bullets = (b.bullets || []).map((x) => scoreText(String(x)).score);
    return {
      id: b.id,
      brick: b,
      score: score / (1 + Math.log(1 + size / 25)),
      top: [...hits.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([c]) => c),
      bullets,
    };
  });

  const covered = new Set(docs.flatMap((d) => [...d]));
  const keyTerms = [...weights.entries()].sort((a, b) => b[1] - a[1]);
  const matched = keyTerms.filter(([c]) => covered.has(c)).slice(0, 14).map(([c]) => c);
  const missing = keyTerms.filter(([c]) => GAP_VOCAB.has(c) && !covered.has(c)).map(([c]) => c);
  return { weights, scored, matched, missing, surface };
}

// ---------------------------------------------------------------- assembling

const SEASON = { winter: 1, spring: 4, summer: 7, fall: 10, autumn: 10 };
export function dateKey(b) {
  const v = String(b.end || b.date || b.start || '').toLowerCase().trim();
  if (!v) return 0;
  if (/present|current|now/.test(v)) return 999999;
  let m = v.match(/^(\d{4})-(\d{1,2})/);
  if (m) return +m[1] * 100 + +m[2];
  m = v.match(/(winter|spring|summer|fall|autumn)\s+(\d{4})/);
  if (m) return +m[2] * 100 + SEASON[m[1]];
  m = v.match(/(\d{4})/);
  return m ? +m[1] * 100 + 6 : 0;
}

const LIMITS = {
  experience: { max: 4, min: 2, bullets: 3 },
  project: { max: 4, min: 2, bullets: 3 },
  skills: { max: 3, min: 2 },
  certification: { max: 3, min: 0 },
  award: { max: 2, min: 0 },
  custom: { max: 1, min: 0, bullets: 3 },
};

function pickBullets(s, keep) {
  const all = (s.brick.bullets || []).map(String);
  if (all.length <= keep) return [];
  const order = all.map((_, i) => i).sort((a, b) => s.bullets[b] - s.bullets[a] || a - b);
  const keepSet = new Set(order.slice(0, keep));
  return all.filter((_, i) => !keepSet.has(i));
}

/**
 * Build a resume layout for a job post.
 * Returns { comp, report } where comp is a normal resume layout and report explains the choices.
 */
export function tailorResume({ jobText, bricks, base = {}, name, today = new Date() }) {
  bricks = ownBricks(bricks);
  const analysis = analyzeJob(jobText, bricks);
  const byType = (t) => analysis.scored.filter((s) => s.brick.type === t);
  const picked = new Map(); // type -> scored list
  const why = [];

  const choose = (type) => {
    const lim = LIMITS[type];
    const list = byType(type);
    const ranked = [...list].sort((a, b) => b.score - a.score || dateKey(b.brick) - dateKey(a.brick));
    // Variants of the same job or project (a duplicated brick): keep only the best one.
    const seen = new Set();
    const variantKey = (b) => String(type === 'experience' ? b.org || b.role : b.name || b.label || b.id).toLowerCase().replace(/\W+/g, ' ').trim();
    const firstOfKind = (s) => {
      const k = variantKey(s.brick);
      if (!k || !seen.has(k)) return seen.add(k), true;
      return false;
    };
    let chosen = ranked.filter((s) => s.score > 0).filter(firstOfKind).slice(0, lim.max);
    if (chosen.length < lim.min) {
      const rest = [...list].filter((s) => !chosen.includes(s)).sort((a, b) => dateKey(b.brick) - dateKey(a.brick)).filter(firstOfKind);
      chosen = chosen.concat(rest.slice(0, lim.min - chosen.length));
    }
    picked.set(type, chosen);
  };
  ['experience', 'project', 'skills', 'certification', 'award'].forEach(choose);

  // Header: the one already in use, else the first one.
  const headers = byType('header');
  const header = headers.find((h) => h.id === base.header) || headers[0];
  // Summary: best match; prefer targeted summaries on ties.
  const summaries = byType('summary').filter((s) => (s.brick.text || '').trim());
  const summary = [...summaries].sort(
    (a, b) => b.score - a.score || ((b.brick.tags || []).includes('target') ? 1 : 0) - ((a.brick.tags || []).includes('target') ? 1 : 0),
  )[0];
  const education = byType('education').sort((a, b) => dateKey(b.brick) - dateKey(a.brick));

  const items = (list, type) =>
    list
      .slice()
      .sort((a, b) => dateKey(b.brick) - dateKey(a.brick))
      .map((s) => {
        const keep = LIMITS[type]?.bullets;
        const hide = keep ? pickBullets(s, keep) : [];
        if (s.score > 0) why.push({ id: s.id, label: blockLabel(s.brick), type, score: s.score, top: s.top });
        return hide.length ? { block: s.id, hide } : { block: s.id };
      });

  const total = (t) => (picked.get(t) || []).reduce((a, s) => a + s.score, 0);
  const expFirst = total('experience') >= total('project');
  // Students and recent grads (studying now, or graduated within the last year) lead with education.
  const todayKey = today.getFullYear() * 100 + today.getMonth() + 1;
  const eduFirst = education.length > 0 && dateKey(education[0].brick) >= todayKey - 100;
  const eduSection = education.length ? { title: 'Education', items: education.map((s) => ({ block: s.id })) } : null;
  const sections = [];
  if (summary) sections.push({ title: 'Summary', items: [{ block: summary.id }] });
  if (eduSection && eduFirst) sections.push(eduSection);
  const exp = { title: 'Experience', items: items(picked.get('experience'), 'experience') };
  const proj = { title: 'Projects', items: items(picked.get('project'), 'project') };
  for (const s of expFirst ? [exp, proj] : [proj, exp]) if (s.items.length) sections.push(s);
  if (eduSection && !eduFirst) sections.push(eduSection);
  const skills = items(picked.get('skills'), 'skills');
  if (skills.length) sections.push({ title: 'Skills', items: skills });
  const certs = items(picked.get('certification'), 'certification');
  if (certs.length) sections.push({ title: 'Certifications', items: certs });
  const awards = items(picked.get('award'), 'award');
  if (awards.length) sections.push({ title: 'Awards', items: awards });

  const comp = {
    name: name || 'Tailored resume',
    settings: { ...(base.settings || {}) },
    header: header ? header.id : null,
    sections,
    job: { text: String(jobText || '').slice(0, 20000), matched: analysis.matched, missing: analysis.missing },
  };
  const report = {
    matched: analysis.matched,
    missing: analysis.missing,
    surface: analysis.surface,
    summary: summary ? blockLabel(summary.brick) : null,
    why: why.sort((a, b) => b.score - a.score),
    scores: new Map(analysis.scored.map((s) => [s.id, s])),
  };
  return { comp, report };
}

/**
 * One trimming step toward one page: hide the weakest remaining bullet (keeping 2 per brick),
 * then drop the weakest extra brick. Returns false when nothing sensible is left to trim.
 */
export function trimOnce(comp, scores) {
  let best = null;
  for (const sec of comp.sections) {
    for (const it of sec.items) {
      const s = scores.get(it.block);
      const bullets = (s?.brick.bullets || []).map(String);
      const hidden = new Set(it.hide || []);
      const shown = bullets.map((b, i) => ({ b, i })).filter((x) => !hidden.has(x.b));
      if (shown.length > 2) {
        const weakest = shown.sort((a, b) => s.bullets[a.i] - s.bullets[b.i] || b.i - a.i)[0];
        const cost = s.bullets[weakest.i];
        if (!best || cost < best.cost) best = { cost, apply: () => (it.hide = [...hidden, weakest.b]) };
      }
    }
  }
  if (best) {
    best.apply();
    return true;
  }
  const droppable = [];
  for (const sec of comp.sections) {
    if (['Summary', 'Education'].includes(sec.title)) continue;
    const floor = ['Experience', 'Projects', 'Skills'].includes(sec.title) ? 1 : 0;
    if (sec.items.length <= floor) continue;
    for (const it of sec.items) droppable.push({ sec, it, score: scores.get(it.block)?.score ?? 0 });
  }
  if (!droppable.length) return false;
  const d = droppable.sort((a, b) => a.score - b.score)[0];
  d.sec.items.splice(d.sec.items.indexOf(d.it), 1);
  comp.sections = comp.sections.filter((s) => s.items.length);
  return true;
}

// ---------------------------------------------------------------- refine with Claude (copy-paste)

export function buildTailorPrompt({ jobText, bricks, comp }) {
  const catalog = ownBricks(bricks)
    .filter((b) => b.type && b.type !== '_error' && b.type !== 'header')
    .map((b) => {
      const o = { id: b.id, type: b.type, label: blockLabel(b) };
      if (b.type === 'summary') o.text = b.text;
      if (b.type === 'skills') o.items = b.items;
      if (b.start || b.end || b.date) o.when = [b.start, b.end || b.date].filter(Boolean).join(' to ');
      if (Array.isArray(b.bullets) && b.bullets.length) o.bullets = b.bullets.map((x, i) => `${i}: ${x}`);
      return o;
    });
  const current = comp.sections.map((s) => ({ title: s.title, items: s.items.map((it) => it.block) }));
  return `I build resumes from reusable "bricks" in an app called Resume Bricks. Choose the best bricks and bullets for the job post below.

## Rules
- Use only the brick ids and bullet numbers listed in the catalog. Do not write, reword or invent any text.
- Aim for one page: one summary, education, and roughly 12 to 16 bullets in total.
- Pick bullets that match what the job asks for; keep at least 2 bullets for each experience or project you include.
- Order experience and projects by relevance, then recency. You may rename section titles.
- List important requirements from the post that none of my bricks cover in "gaps", so I don't claim them.

## Job post
${String(jobText || '').trim().slice(0, 15000)}

## My current automatic draft (section: brick ids)
${current.map((s) => `- ${s.title}: ${s.items.join(', ')}`).join('\n')}

## Catalog of my bricks
${JSON.stringify(catalog, null, 1)}

## Output format
Reply with one JSON object only (a \`\`\`json code block is fine):
{
  "sections": [
    { "title": "Summary", "items": [{ "id": "summary-id" }] },
    { "title": "Experience", "items": [{ "id": "brick-id", "bullets": [0, 2, 3] }] }
  ],
  "why": "one or two sentences on the choice",
  "gaps": ["requirement not covered"]
}`;
}

/** Claude's reply -> a layout that only uses existing bricks and bullets. */
export function applyTailorReply(text, bricks, base) {
  const data = extractJson(String(text || ''));
  const byId = new Map(ownBricks(bricks).map((b) => [b.id, b]));
  const sections = [];
  const skipped = [];
  for (const sec of Array.isArray(data.sections) ? data.sections : []) {
    const items = [];
    for (const it of Array.isArray(sec.items) ? sec.items : []) {
      const id = typeof it === 'string' ? it : it?.id;
      const b = byId.get(id);
      if (!b || b.type === 'header') {
        if (id) skipped.push(String(id));
        continue;
      }
      const all = (b.bullets || []).map(String);
      const want = Array.isArray(it.bullets) ? new Set(it.bullets.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < all.length)) : null;
      const hide = want && want.size ? all.filter((_, i) => !want.has(i)) : [];
      items.push(hide.length ? { block: id, hide } : { block: id });
    }
    if (items.length) sections.push({ title: String(sec.title || 'Section').slice(0, 60), items });
  }
  if (!sections.length) throw new Error('The reply had no bricks from your library in it.');
  return {
    comp: { ...base, sections },
    why: typeof data.why === 'string' ? data.why : '',
    gaps: Array.isArray(data.gaps) ? data.gaps.map(String) : [],
    skipped,
  };
}

// ---------------------------------------------------------------- display

export const termLabel = (c, surface) => TERM_LABELS[c] || surface?.get(c) || c;
