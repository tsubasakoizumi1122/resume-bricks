// Ids are file names (local version) or keys (web version): lowercase, safe, readable.
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;

export function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

export function slugify(s) {
  const slug = String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s_-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return slug || 'item';
}

/** How a new item's id is guessed from its content. */
export function idHint(kind, body) {
  if (kind === 'resumes') return body.name || 'resume';
  const label = body.title || body.org || body.name || body.school || body.label || body.heading || '';
  return `${body.type || 'brick'}-${label}`;
}
