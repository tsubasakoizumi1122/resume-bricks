// "From my work": build a prompt from your own material, then turn Claude's reply into draft bricks.
// Pure functions (no DOM), shared by the browser and the tests.
import { TYPES } from './schema.js';

const MAX_MATERIAL = 90000; // characters of source text in one prompt
const ALLOWED = ['project', 'experience', 'skills', 'certification', 'award', 'summary', 'custom'];

function clipSources(sources) {
  const total = sources.reduce((n, s) => n + s.text.length, 0);
  if (total <= MAX_MATERIAL) return sources;
  const ratio = MAX_MATERIAL / total;
  return sources.map((s) => {
    const keep = Math.max(2000, Math.floor(s.text.length * ratio));
    return s.text.length > keep ? { ...s, text: `${s.text.slice(0, keep)}\n[...the rest was cut to keep the prompt short]` } : s;
  });
}

/**
 * sources: [{ label, kind, text }]
 * about:   { name, role, dates, target, notes }
 * examples: bullets from the user's existing bricks, to match their style
 * existing: labels of bricks they already have
 */
export function buildWorkPrompt({ sources = [], about = {}, examples = [], existing = [] }) {
  const clipped = clipSources(sources.filter((s) => s.text && s.text.trim()));
  const aboutLines = [
    about.name && `- Name of the work: ${about.name}`,
    about.role && `- My role: ${about.role}`,
    about.dates && `- When: ${about.dates}`,
    about.notes && `- Notes from me: ${about.notes.trim()}`,
  ].filter(Boolean);

  const parts = [
    `I keep my resume as reusable "bricks" in an app called Resume Bricks. Please read my work below and write bricks that describe it. Reply with JSON only, in the format at the end.`,
    `## Rules
- Use only facts that appear in the material or in my notes. Never invent numbers, results, tools, dates or outcomes.
- If a stronger bullet would need a number or result that is not in the material, do not guess. Ask for it in "questions" instead.
- Describe only what I did. If the material does not make my part clear (a group project, for example), ask in "questions".
- If the work was a proposal, plan or design that was not carried out, say so (designed, proposed, planned), never as completed.
- Bullets: start with a strong verb (past tense, or present tense if ongoing), about 12 to 25 words, one sentence, no ending period, no "I".
- Write 3 to 6 bullets per brick, covering different angles when the work supports it (analysis, communication, technical, leadership). I choose which bullets to show for each application.
- Write in English, even when the material is in Japanese.
- Dates: "YYYY-MM", "Spring 2025" style, or "present". Leave a field out when you don't know it.${
      about.target ? `\n- I am applying for roles like: ${about.target}. Lean toward what those roles value, without changing any facts.` : ''
    }`,
  ];
  if (examples.length) {
    parts.push(`## My writing style (bullets from my current resume)\n${examples.slice(0, 6).map((b) => `- ${b}`).join('\n')}`);
  }
  if (existing.length) {
    parts.push(`## Bricks I already have (don't repeat these)\n${existing.slice(0, 40).map((l) => `- ${l}`).join('\n')}`);
  }
  if (aboutLines.length) parts.push(`## About this work\n${aboutLines.join('\n')}`);
  parts.push(
    `## Material\n${clipped.length ? clipped.map((s, i) => `### Source ${i + 1}: ${s.label}${s.kind ? ` (${s.kind})` : ''}\n${s.text.trim()}`).join('\n\n') : '(no files; use my notes above)'}`,
  );
  parts.push(`## Output format
Reply with one JSON object and nothing else (a \`\`\`json code block is fine):
{
  "bricks": [
    { "type": "project", "name": "", "role": "", "link": "", "start": "", "end": "", "bullets": [""], "tags": [""] },
    { "type": "skills", "label": "", "items": [""] }
  ],
  "questions": [""]
}
Types: "project" (default for a piece of work), "experience" (a job or position: use "role", "org", "location" instead of "name"), "skills" (only tools and methods clearly used in the material), "certification" or "award" ("name", "issuer", "date").
Usually one project brick is right. Add a second one only if the material clearly covers separate pieces of work.`);
  return parts.join('\n\n');
}

/** Pull the JSON object out of a chat reply (code fences, extra prose, trailing commas). */
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fenced ? fenced[1] : text;
  const a = body.indexOf('{');
  const b = body.lastIndexOf('}');
  if (a === -1 || b <= a) throw new Error('No JSON found in the reply. Copy Claude\'s whole answer, including the { } part.');
  body = body.slice(a, b + 1).replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1');
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new Error(`The reply's JSON could not be read (${e.message}). Ask Claude to "reply with valid JSON only" and paste again.`);
  }
}

const str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const strList = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : str(v) ? [str(v)] : []);

/** Keep only the fields the brick type knows, with clean strings. */
export function cleanBrick(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let type = str(raw.type).toLowerCase();
  if (!ALLOWED.includes(type)) type = 'project';
  const b = { type };
  for (const f of TYPES[type].fields) {
    const v = raw[f.key];
    if (f.kind === 'list' || f.kind === 'tags') {
      const list = strList(v).map((x) => x.replace(/\.$/, ''));
      if (list.length) b[f.key] = list;
    } else if (f.kind === 'links') {
      const links = (Array.isArray(v) ? v : []).filter((l) => l && l.url).map((l) => ({ label: str(l.label), url: str(l.url) }));
      if (links.length) b[f.key] = links;
    } else if (str(v)) b[f.key] = str(v);
  }
  if (type === 'project' && !b.name && str(raw.title)) b.name = str(raw.title);
  const tags = [...new Set([...strList(raw.tags).map((t) => t.toLowerCase().replace(/\s+/g, '-')), 'from-work'])];
  b.tags = tags;
  return Object.keys(b).length > 2 ? b : null;
}

/** Claude's reply -> { bricks, questions }. Throws a readable Error when it can't. */
export function parseClaudeReply(text) {
  const data = extractJson(String(text || ''));
  const rawBricks = Array.isArray(data) ? data : Array.isArray(data.bricks) ? data.bricks : [];
  const bricks = rawBricks.map(cleanBrick).filter(Boolean);
  if (!bricks.length) throw new Error('The reply had no bricks in it.');
  const questions = strList(data.questions);
  return { bricks, questions };
}
