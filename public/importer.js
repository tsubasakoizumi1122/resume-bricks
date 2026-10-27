// Resume text -> draft bricks + a layout in the same order.
// Pure functions (no DOM), shared by the browser and the tests.
// It is a best guess by design: the import dialog lets you review every draft before saving.

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const SEASON_RE = '(?:spring|summer|fall|autumn|winter)';
const TOKEN = `(?:${MONTH_RE}\\.?\\s+\\d{4}|${SEASON_RE}\\s+\\d{4}|\\d{1,2}\\/\\d{4}|\\d{4}-\\d{2}|(?:19|20)\\d{2})`;
const END = `(?:${TOKEN}|present|current|now|ongoing|today)`;
const RANGE_RE = new RegExp(`(${TOKEN})\\s*(?:–|—|-|to|~)\\s*(${END})`, 'i');
const SINGLE_RE = new RegExp(`(?:^|[\\s|(,])((?:${MONTH_RE}\\.?\\s+\\d{4})|(?:${SEASON_RE}\\s+\\d{4})|\\d{1,2}\\/\\d{4}|(?:expected\\s+)?(?:${MONTH_RE}\\.?\\s+)?(?:19|20)\\d{2})(?=$|[\\s|),])`, 'i');
const BULLET_RE = /^\s*(?:[•●▪◦‣∙·○■□➢➤►▶✓✔\-–—*]|\d{1,2}[.)])\s+/;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/;
const URL_RE = /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|[\w-]+\.(?:com|io|me|dev|org|net|app|co|jp))(?:\/[^\s|,]*)?/i;
const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
const PLACE = "[A-Z][a-z.'-]+(?: [A-Z][a-z.'-]+){0,2}";
const LOCATION_RE = new RegExp(
  `^(?:remote|hybrid|online|${PLACE},\\s*(?:${US_STATES}|[A-Z][a-z]+(?: [A-Z][a-z]+)?)|japan|usa|united states|tokyo|osaka|singapore|london)(?:\\s*\\((?:remote|hybrid|on-?site)\\))?$`,
);
const TRAILING_LOCATION_RE = new RegExp(`,\\s*(${PLACE},\\s*(?:${US_STATES}|Japan|USA))$`);
const NOT_PLACE = /\b(inc|llc|ltd|corp|company|group|partners|advisors|development|properties|capital|holdings|associates|consulting|bank|university|college|school|institute|department|dept)\b/i;
const ROLE_WORDS = /\b(intern|analyst|manager|coordinator|assistant|associate|engineer|director|volunteer|member|staff|instructor|lead|leader|president|officer|specialist|consultant|developer|designer|tutor|fellow|researcher|representative|advisor|planner|chair|captain|head|owner|founder|co-founder|teacher|clerk|agent|broker|trainee|ambassador|editor|writer|secretary|treasurer)\b/i;
const SCHOOL_WORDS = /\b(university|college|school|institute|academy|polytechnic)\b/i;
const DEGREE_STRICT = /\b(bachelor|master|associate (of|in)|b\.a\.?|b\.s\.?|m\.a\.?|m\.s\.?|mba|ph\.?d|diploma|doctor of)\b/i;
const DEGREE_WORDS = /\b(bachelor|master|b\.?a\.?|b\.?s\.?|m\.?a\.?|m\.?s\.?|mba|ph\.?d|associate|diploma|minor|major|degree|certificate program|high school diploma)\b/i;

// ---------------------------------------------------------------- small helpers

export function toDateValue(token) {
  if (!token) return '';
  const s = token.trim().replace(/^expected\s+/i, '');
  if (/^(present|current|now|ongoing|today)$/i.test(s)) return 'present';
  let m = s.match(new RegExp(`^(${MONTH_RE})\\.?\\s+(\\d{4})$`, 'i'));
  if (m) return `${m[2]}-${String(MONTH_KEYS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1).padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = s.match(new RegExp(`^(${SEASON_RE})\\s+(\\d{4})$`, 'i'));
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`;
  return s;
}

/** Find a date range (or single date) in a line; returns the dates and the line without them. */
export function takeDates(line) {
  let m = line.match(RANGE_RE);
  if (m) return { start: toDateValue(m[1]), end: toDateValue(m[2]), rest: line.replace(m[0], ' ') };
  m = line.match(SINGLE_RE);
  if (m) return { start: '', end: toDateValue(m[1]), rest: line.replace(m[1], ' ') };
  return { start: '', end: '', rest: line };
}

const hasDate = (line) => RANGE_RE.test(line) || SINGLE_RE.test(line);

/** Split a header line into its pieces: "Org | San Diego, CA" -> ["Org", "San Diego, CA"]. */
export function fragments(text) {
  return text
    .split(/\s+\|\s+|\s*\|\s*|\s{2,}|\s[•·]\s|\s[–—]\s|\t/)
    .map((f) => f.replace(/^[,;:\s–—-]+|[,;:\s–—-]+$/g, '').trim())
    .map((f) => (/^\(.*\)$/.test(f) ? f.slice(1, -1).trim() : f))
    .filter(Boolean);
}

const COUNTRY_RE = /^(remote|hybrid|online|japan|usa|u\.s\.a?\.?|united states|tokyo|osaka|singapore|london|korea|china|taiwan)(\s*\((remote|hybrid|on-?site)\))?$/i;
// "Canada (Remote)", "Oregon (Hybrid)": any short place name followed by a work mode is a location.
const WORK_MODE_RE = /^[A-Z][A-Za-z.'-]+(?:[ ,]+[A-Z][A-Za-z.'-]+){0,3}\s*\((?:[Rr]emote|[Hh]ybrid|[Oo]n-?[Ss]ite)\)$/;
const isLocation = (f) => {
  const t = f.trim();
  if (COUNTRY_RE.test(t)) return true;
  return (LOCATION_RE.test(t) || WORK_MODE_RE.test(t)) && !ROLE_WORDS.test(t) && !NOT_PLACE.test(t);
};
const hasLocation = (line) => fragments(line).some(isLocation);

/** Split "a, b (c, d), e" on commas that are not inside parentheses. */
export function splitList(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[,;•·|]/.test(ch)) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map((s) => s.replace(/\.$/, ''));
}

function titleCase(s) {
  const small = new Set(['and', 'of', 'the', 'in', 'for', 'to', 'a', 'an', 'on', 'at', '&']);
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

// ---------------------------------------------------------------- sections

const SECTION_WORDS =
  /^(summary|professional summary|profile|objective|about( me)?|education|academic background|experience|work experience|professional experience|relevant experience|employment( history)?|leadership|leadership experience|experience (and|&) leadership|leadership (and|&) activities|activities|extracurricular activities|involvement|campus involvement|volunteer( experience| work)?|community (service|involvement)|projects|academic projects|selected projects|research|research experience|research (and|&) analysis projects|research (and|&) projects|skills|technical skills|skills (and|&) interests|skills (and|&) languages|languages|tools|certifications?|certificates|licenses( (and|&) certifications)?|certifications (and|&) (additional|awards|training)|courses|coursework|relevant coursework|training|awards|honors|honors (and|&) awards|awards (and|&) honors|achievements|publications|additional( information)?|interests)$/i;

export function isSectionHeading(line) {
  const t = line.replace(/[:：]$/, '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 45 || /\d/.test(t) || EMAIL_RE.test(t)) return false;
  if (SECTION_WORDS.test(t)) return true;
  const letters = t.replace(/[^A-Za-z]/g, '');
  return letters.length >= 4 && t === t.toUpperCase() && t.split(' ').length <= 5 && /^[A-Z &/,-]+$/.test(t);
}

export function sectionType(title) {
  const t = title.toLowerCase();
  if (/summary|profile|objective|about/.test(t)) return 'summary';
  if (/project|research|portfolio|publication/.test(t)) return 'project';
  if (/education|academic background/.test(t)) return 'education';
  if (/skill|language|tools|technolog|competenc|interest/.test(t)) return 'skills';
  if (/award|honou?r|achievement|scholarship/.test(t)) return 'award';
  if (/certif|licen|course|training/.test(t)) return 'certification';
  if (/experience|employment|work|leadership|volunteer|activit|involvement|extracurricular|community/.test(t)) return 'experience';
  return 'custom';
}

// ---------------------------------------------------------------- header

function parseHeader(lines) {
  const h = { type: 'header' };
  const links = [];
  const rest = [];
  lines.forEach((raw, lineNo) => {
    let found = false;
    const bits = raw.split(/\s*[|•·]\s*|\s{2,}/).map((s) => s.trim()).filter(Boolean);
    const leftover = [];
    for (const b of bits) {
      const email = b.match(EMAIL_RE);
      if (email && !h.email) {
        h.email = email[0];
        found = true;
        continue;
      }
      if (!h.phone && PHONE_RE.test(b) && b.replace(/\D/g, '').length >= 9 && b.replace(/[\d\s().+-]/g, '').length <= 3) {
        h.phone = b.match(PHONE_RE)[0].trim();
        found = true;
        continue;
      }
      const url = b.match(URL_RE);
      if (url && !/\s/.test(b.replace(/^(linkedin|github|portfolio|website)\s*:\s*/i, ''))) {
        const u = url[0];
        links.push({ label: u.replace(/^https?:\/\/(www\.)?/, ''), url: /^https?:/.test(u) ? u : `https://${u}` });
        found = true;
        continue;
      }
      if (!h.location && isLocation(b)) {
        h.location = b;
        found = true;
        continue;
      }
      leftover.push(b);
    }
    // Words left on a contact line are usually link text ("Portfolio"), not a headline.
    if (leftover.length && (!found || lineNo === 0)) rest.push(leftover.join(' '));
  });
  if (rest.length) h.name = rest.shift();
  if (rest.length && rest[0].length <= 90) h.headline = rest.shift();
  if (links.length) h.links = links;
  return h.name || h.email ? h : null;
}

// ---------------------------------------------------------------- entries

function isHeadLine(line, next, afterBullet = false) {
  if (line.length > 140) return false;
  if (hasDate(line) || hasLocation(line)) return true;
  // A short title line right above a dated line ("Org" then "Role | Jun 2025 – present").
  const titleAbove = line.length <= 70 && !/[.;]$/.test(line) && !/^[a-z]/.test(line) && !!next && (hasDate(next) || hasLocation(next)) && !BULLET_RE.test(next);
  if (!titleAbove) return false;
  // Right after a bullet, a short line is usually that bullet's sibling, unless it looks like a title
  // or the dated line below has nothing but a role in it.
  if (!afterBullet) return true;
  if (ROLE_WORDS.test(line) || SCHOOL_WORDS.test(line)) return true;
  const below = fragments(takeDates(next).rest).filter((f) => !isLocation(f));
  return below.length === 0 || below.every((f) => ROLE_WORDS.test(f));
}

const STARTS_WITH_VERB = /^([A-Z][a-z]+(ed|ing)|Wrote|Led|Built|Ran|Made|Took|Began|Drove|Grew|Won|Sold|Kept|Set|Met|Taught|Spoke|Gave|Brought|Found|Held|Oversaw|Drew|Chose|Shot|Went|Did|Got|Saw|Thought|Told|Leads?|Manages?|Supports?|Builds?|Creates?|Coordinates?|Develops?|Helps?|Handles?|Runs?|Writes?|Serves?)\b/;
const CONTINUES = /(,|-|–|\b(and|or|of|to|the|for|with|in|on|by|a|an|&))$/i;

/** Group the lines of one section into entries: { head: [...], bullets: [...] }. */
function groupEntries(lines, type) {
  const marked = lines.some((l) => BULLET_RE.test(l));
  const entries = [];
  let cur = null;
  let lastWasBullet = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    if (BULLET_RE.test(line)) {
      if (!cur) entries.push((cur = { head: [], bullets: [] }));
      cur.bullets.push(line.replace(BULLET_RE, '').trim());
      lastWasBullet = true;
      continue;
    }
    const inBullets = !!cur && cur.bullets.length > 0;
    const datedHead = !!cur && !cur.bullets.length && cur.head.some(hasDate);
    if (!datedHead && isHeadLine(line, next, inBullets) || (datedHead && hasDate(line) && cur.head.length < 3 && !hasDate(cur.head.join(' ')))) {
      if (!cur || cur.bullets.length || cur.head.length >= 3) entries.push((cur = { head: [], bullets: [] }));
      cur.head.push(line);
      lastWasBullet = false;
      continue;
    }
    const prev = cur?.bullets[cur.bullets.length - 1];
    if (prev !== undefined && lastWasBullet && (marked || /^[a-z(]/.test(line) || CONTINUES.test(prev))) {
      cur.bullets[cur.bullets.length - 1] = `${prev} ${line}`;
      continue;
    }
    if (!cur) {
      entries.push((cur = { head: [line], bullets: [] }));
      lastWasBullet = false;
      continue;
    }
    // One short subtitle right after the dated line ("Research proposal, GEOG 499", a degree).
    if (cur && !cur.bullets.length && cur.head.length === 1 && hasDate(cur.head[0]) && !cur.subtitle) {
      const looksLikeSubtitle =
        type === 'education'
          ? DEGREE_STRICT.test(line) && !cur.head.some((h) => DEGREE_STRICT.test(h)) && line.length <= 90
          : line.length <= 60 && !/[.]$/.test(line) && !STARTS_WITH_VERB.test(line) && !/^[A-Za-z][\w ./&-]{1,25}:\s/.test(line);
      if (looksLikeSubtitle) {
        cur.head.push(line);
        cur.subtitle = true;
        lastWasBullet = false;
        continue;
      }
    }
    // Once an entry has its dated line, the short lines after it are content, not more title.
    if (!cur.bullets.length && !cur.head.some(hasDate) && cur.head.length < 3 && line.length <= 60 && !/[.]$/.test(line) && !/^[A-Za-z][\w ./&-]{1,25}:\s/.test(line)) {
      cur.head.push(line);
      lastWasBullet = false;
      continue;
    }
    cur.bullets.push(line);
    lastWasBullet = true;
  }
  return entries;
}

function describeHead(head) {
  let start = '';
  let end = '';
  let location = '';
  let link = '';
  const frags = [];
  for (const line of head) {
    const d = takeDates(line);
    if ((d.start || d.end) && !start && !end) {
      start = d.start;
      end = d.end;
    }
    for (let f of fragments(start || end ? d.rest : line)) {
      const url = f.match(URL_RE);
      if (!link && url && /[./]/.test(url[0]) && (/\//.test(url[0]) || !/\s/.test(f))) {
        link = url[0];
        f = f.replace(url[0], '').trim();
        if (!f) continue;
      }
      if (!location && isLocation(f)) {
        location = f;
        continue;
      }
      const tail = !location && f.match(TRAILING_LOCATION_RE);
      if (tail && isLocation(tail[1])) {
        location = tail[1];
        f = f.slice(0, tail.index).trim();
      }
      // "Research Assistant, Pacific Land Advisors" -> two pieces
      const comma = f.indexOf(', ');
      if (comma > 0) {
        const a = f.slice(0, comma);
        const b = f.slice(comma + 2);
        if (ROLE_WORDS.test(a) !== ROLE_WORDS.test(b) && !/\d/.test(a + b)) {
          frags.push(a, b);
          continue;
        }
      }
      frags.push(f);
    }
  }
  if (start && !end) end = start;
  if (start === end) start = '';
  return { start, end, location, link, frags };
}

function toBrick(type, entry) {
  const { start, end, location, link, frags } = describeHead(entry.head);
  const bullets = entry.bullets.filter(Boolean);
  const b = { type };
  const put = (k, v) => {
    if (v) b[k] = v;
  };
  if (type === 'experience') {
    let [org, role, ...more] = frags;
    if (org && role && ROLE_WORDS.test(org) && !ROLE_WORDS.test(role)) [org, role] = [role, org];
    if (!role && org && ROLE_WORDS.test(org)) [role, org] = [org, undefined];
    put('role', [role, ...more].filter(Boolean).join(', '));
    put('org', org);
    put('location', location);
  } else if (type === 'education') {
    const school = frags.find((f) => SCHOOL_WORDS.test(f)) || frags[0];
    const others = frags.filter((f) => f !== school);
    const degree = others.find((f) => DEGREE_WORDS.test(f)) || others[0];
    put('school', school);
    put('degree', [degree, ...others.filter((f) => f !== degree)].filter(Boolean).join(', '));
    put('location', location);
  } else if (type === 'project') {
    put('name', frags[0]);
    put('role', [frags.slice(1).join(', '), location].filter(Boolean).join(', '));
    put('link', link);
  } else {
    put('heading', frags[0]);
    put('right', [frags.slice(1).join(', '), location].filter(Boolean).join(', '));
  }
  put('start', start);
  put('end', end);
  if (bullets.length) b.bullets = bullets;
  return b;
}

function joinWrapped(lines) {
  const out = [];
  for (const raw of lines) {
    const line = raw.replace(BULLET_RE, '').trim();
    const prev = out[out.length - 1];
    if (prev !== undefined && !BULLET_RE.test(raw) && (/^[a-z(]/.test(line) || CONTINUES.test(prev))) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out.filter(Boolean);
}

function skillBricks(lines, title) {
  const out = [];
  const loose = [];
  for (const line of joinWrapped(lines)) {
    const m = line.match(/^([^:：]{1,40})[:：]\s*(.+)$/);
    if (m) out.push({ type: 'skills', label: m[1].trim(), items: splitList(m[2]) });
    else loose.push(...splitList(line));
  }
  if (loose.length) out.unshift({ type: 'skills', label: out.length ? (/skill/i.test(title) ? 'Skills' : titleCase(title)) : '', items: loose });
  return out;
}

function listBricks(lines, type) {
  return joinWrapped(lines).map((line) => {
    const d = takeDates(line);
    let parts = fragments(d.rest);
    if (parts.length === 1) {
      const i = parts[0].lastIndexOf(', ');
      if (i > 8 && parts[0].length - i < 60) parts = [parts[0].slice(0, i), parts[0].slice(i + 2)];
    }
    const b = { type, name: parts[0] || line };
    if (parts[1]) b.issuer = parts.slice(1).join(', ');
    if (d.end || d.start) b.date = d.end || d.start;
    return b;
  });
}

// ---------------------------------------------------------------- main

/**
 * Parse resume text into { header, sections: [{ title, type, blocks }], warnings }.
 * Every brick gets the tag "imported" so new bricks are easy to find.
 */
export function parseResume(text) {
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && !/^page \d+( of \d+)?$/i.test(l));

  const warnings = [];
  const headIdx = lines.findIndex(isSectionHeading);
  const header = parseHeader(headIdx === -1 ? lines.slice(0, 3) : lines.slice(0, headIdx));
  const sections = [];
  let cur = null;
  const body = headIdx === -1 ? lines.slice(header ? 3 : 0) : lines.slice(headIdx);
  if (headIdx === -1) {
    warnings.push('No section headings were found, so everything went into one section. Check the types before importing.');
    cur = { title: 'Experience', lines: [] };
    sections.push(cur);
  }
  for (const line of body) {
    if (isSectionHeading(line)) {
      cur = { title: titleCase(line.replace(/[:：]$/, '')), lines: [] };
      sections.push(cur);
    } else cur.lines.push(line);
  }

  const out = [];
  for (const s of sections) {
    const type = sectionType(s.title);
    let blocks;
    if (type === 'summary') blocks = s.lines.length ? [{ type, text: joinWrapped(s.lines).join(' ') }] : [];
    else if (type === 'skills') blocks = skillBricks(s.lines, s.title);
    else if (type === 'certification' || type === 'award') blocks = listBricks(s.lines, type);
    else blocks = groupEntries(s.lines, type).map((e) => toBrick(type, e));
    blocks = blocks.filter((b) => Object.keys(b).length > 1).map((b) => ({ ...b, tags: ['imported'] }));
    if (blocks.length) out.push({ title: s.title, type, blocks });
  }
  if (header) header.tags = ['imported'];
  if (!out.length) warnings.push('Could not find any entries. Try pasting the text instead.');
  return { header, sections: out, warnings };
}
