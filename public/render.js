// Pure functions that turn (resume layout + bricks) into HTML or Markdown.
// No DOM access, so this module also runs under Node for tests.

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENT[c]);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(v) {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v).trim();
  if (/^(present|current|now)$/i.test(s)) return 'Present';
  const m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${MONTHS[+m[2] - 1]} ${m[1]}`;
  return s;
}

export function dateRange(a, b) {
  const A = fmtDate(a);
  const B = fmtDate(b);
  if (A && B) return A === B ? A : `${A} – ${B}`;
  return A || B;
}

/** Minimal inline markup: **bold** and [text](https://url). */
export function inline(s) {
  let h = esc(s);
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\[([^\]]+)\]\(((?:https?:|mailto:)[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return h;
}

const toList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter((x) => x.trim());

export function visibleBullets(block, item) {
  const hide = new Set(item?.hide || []);
  return toList(block.bullets).filter((x) => !hide.has(x));
}

const shortUrl = (u) => String(u).replace(/^mailto:/, '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
const safeUrl = (u) => (/^(https?:|mailto:)/i.test(String(u)) ? String(u) : `https://${u}`);

const row = (l, r) =>
  `<div class="row"><div class="l">${l}</div>${r ? `<div class="r">${r}</div>` : ''}</div>`;

function ul(block, item) {
  const list = visibleBullets(block, item);
  return list.length ? `<ul>${list.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>` : '';
}

const HTML = {
  summary: (b) => `<p class="summary">${inline(b.text)}</p>`,

  experience: (b, it) =>
    `<div class="entry">${row(`<strong>${esc(b.org)}</strong>`, esc(b.location))}${row(
      `<em>${esc(b.role)}</em>`,
      esc(dateRange(b.start, b.end)),
    )}${ul(b, it)}</div>`,

  education: (b, it) =>
    `<div class="entry">${row(`<strong>${esc(b.school)}</strong>`, esc(b.location))}${row(
      `<em>${esc(b.degree)}</em>`,
      esc(dateRange(b.start, b.end)),
    )}${ul(b, it)}</div>`,

  project: (b, it) => {
    const name = `<strong>${esc(b.name)}</strong>${
      b.link ? ` <a class="link" href="${esc(safeUrl(b.link))}">${esc(shortUrl(b.link))}</a>` : ''
    }`;
    const role = b.role ? row(`<em>${esc(b.role)}</em>`, '') : '';
    return `<div class="entry">${row(name, esc(dateRange(b.start, b.end)))}${role}${ul(b, it)}</div>`;
  },

  skills: (b) =>
    `<p class="skill">${b.label ? `<strong>${esc(b.label)}:</strong> ` : ''}${esc(toList(b.items).join(', '))}</p>`,

  certification: (b) =>
    `<div class="entry compact">${row(
      `<strong>${esc(b.name)}</strong>${b.issuer ? `, ${esc(b.issuer)}` : ''}`,
      esc(fmtDate(b.date)),
    )}</div>`,

  custom: (b, it) =>
    `<div class="entry">${b.heading || b.right ? row(`<strong>${esc(b.heading)}</strong>`, esc(b.right)) : ''}${
      b.text ? `<p>${inline(b.text)}</p>` : ''
    }${ul(b, it)}</div>`,
};
HTML.award = HTML.certification;

export function renderHeader(b) {
  if (!b) return '';
  const bits = [];
  if (b.location) bits.push(esc(b.location));
  if (b.phone) bits.push(esc(b.phone));
  if (b.email) bits.push(`<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`);
  for (const l of Array.isArray(b.links) ? b.links : []) {
    if (!l?.url) continue;
    bits.push(`<a href="${esc(safeUrl(l.url))}">${esc(l.label || shortUrl(l.url))}</a>`);
  }
  return `<header class="r-head"><h1>${esc(b.name)}</h1>${
    b.headline ? `<div class="headline">${esc(b.headline)}</div>` : ''
  }${bits.length ? `<div class="contact">${bits.join('<span class="sep">|</span>')}</div>` : ''}</header>`;
}

export function renderBlockHTML(block, item) {
  const fn = HTML[block?.type];
  return fn ? fn(block, item) : '';
}

export function renderResume(comp, byId) {
  let html = renderHeader(comp.header ? byId.get(comp.header) : null);
  for (const sec of comp.sections || []) {
    const parts = (sec.items || [])
      .map((it) => renderBlockHTML(byId.get(it.block), it))
      .filter(Boolean);
    if (!parts.length) continue;
    // The title and the first entry travel together, so a page break never strands a heading.
    const [first, ...rest] = parts;
    const lead = sec.title ? `<div class="sec-lead"><h2>${esc(sec.title)}</h2>${first}</div>` : first;
    html += `<section>${lead}${rest.join('')}</section>`;
  }
  return html;
}

// ---------- Markdown ----------

const mdBullets = (b, it) => visibleBullets(b, it).map((x) => `- ${x}`).join('\n');
const join = (...xs) => xs.filter(Boolean).join('\n');
const MD = {
  summary: (b) => String(b.text || ''),
  experience: (b, it) =>
    join(`**${b.org || ''}**${b.location ? ` · ${b.location}` : ''}  `, `*${b.role || ''}* · ${dateRange(b.start, b.end)}`, mdBullets(b, it)),
  education: (b, it) =>
    join(`**${b.school || ''}**${b.location ? ` · ${b.location}` : ''}  `, `*${b.degree || ''}* · ${dateRange(b.start, b.end)}`, mdBullets(b, it)),
  project: (b, it) =>
    join(`**${b.name || ''}**${b.link ? ` · ${b.link}` : ''} · ${dateRange(b.start, b.end)}`, b.role ? `*${b.role}*` : '', mdBullets(b, it)),
  skills: (b) => `${b.label ? `**${b.label}:** ` : ''}${toList(b.items).join(', ')}`,
  certification: (b) => `**${b.name || ''}**${b.issuer ? `, ${b.issuer}` : ''}${b.date ? ` · ${fmtDate(b.date)}` : ''}`,
  custom: (b, it) => join(b.heading ? `**${b.heading}**${b.right ? ` · ${b.right}` : ''}` : '', b.text, mdBullets(b, it)),
};
MD.award = MD.certification;

export function renderMarkdown(comp, byId) {
  const out = [];
  const h = comp.header ? byId.get(comp.header) : null;
  if (h) {
    out.push(`# ${h.name || ''}`);
    if (h.headline) out.push(h.headline);
    const c = [h.location, h.phone, h.email, ...(h.links || []).map((l) => (l?.label ? `[${l.label}](${l.url})` : l?.url))];
    out.push(c.filter(Boolean).join(' | '));
  }
  for (const sec of comp.sections || []) {
    const parts = (sec.items || [])
      .map((it) => {
        const b = byId.get(it.block);
        return b && MD[b.type] ? MD[b.type](b, it) : '';
      })
      .filter(Boolean);
    if (!parts.length) continue;
    out.push(`\n## ${sec.title || ''}\n`);
    out.push(parts.join('\n\n'));
  }
  return out.join('\n') + '\n';
}
