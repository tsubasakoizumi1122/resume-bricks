// Gather text about a piece of work from a GitHub repo or a folder on this computer.
import { promises as fs } from 'node:fs';
import path from 'node:path';

const TEXT_EXT = /\.(md|markdown|txt|rst)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'venv', '.venv', '__pycache__', 'coverage', '.cache']);
const LANG = {
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript', '.py': 'Python', '.r': 'R',
  '.ipynb': 'Jupyter Notebook', '.sql': 'SQL', '.html': 'HTML', '.css': 'CSS', '.go': 'Go', '.rs': 'Rust', '.java': 'Java',
  '.swift': 'Swift', '.lua': 'Lua', '.luau': 'Luau', '.cs': 'C#', '.cpp': 'C++', '.rb': 'Ruby', '.php': 'PHP', '.qgz': 'QGIS project',
  '.aprx': 'ArcGIS Pro project', '.xlsx': 'Excel workbook', '.gs': 'Apps Script',
};
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n[...cut to keep the prompt short]` : s);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Public GitHub repository: description, topics, languages, dates and README. */
export async function githubToText(url) {
  const m = String(url).trim().match(/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#]|$)/i);
  if (!m) throw httpError(400, 'That does not look like a GitHub repository link (github.com/owner/repo).');
  const [, owner, repo] = m;
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = { 'user-agent': 'resume-bricks', accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let info;
  try {
    let r = await fetch(api, { headers });
    if (r.status === 401 && headers.authorization) {
      delete headers.authorization; // a stale GITHUB_TOKEN should not block public repos
      r = await fetch(api, { headers });
    }
    if (r.status === 404) {
      throw httpError(404, 'Repository not found. If it is private, add its folder on your computer instead.');
    }
    if (r.status === 403) throw httpError(429, 'GitHub is rate limiting requests. Try again in a few minutes, or add the local folder.');
    if (!r.ok) throw httpError(502, `GitHub answered ${r.status}.`);
    info = await r.json();
  } catch (e) {
    if (e.status) throw e;
    throw httpError(502, 'Could not reach GitHub. Check your internet connection, or add the local folder instead.');
  }
  const [readme, langs] = await Promise.all([
    fetch(`${api}/readme`, { headers: { ...headers, accept: 'application/vnd.github.raw' } }).then((r) => (r.ok ? r.text() : '')).catch(() => ''),
    fetch(`${api}/languages`, { headers }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  ]);
  const lines = [
    `Repository: ${info.full_name} (${info.html_url})`,
    info.description && `Description: ${info.description}`,
    info.topics?.length && `Topics: ${info.topics.join(', ')}`,
    Object.keys(langs).length && `Languages: ${Object.keys(langs).join(', ')}`,
    `Created: ${info.created_at?.slice(0, 10)}  Last push: ${info.pushed_at?.slice(0, 10)}`,
    info.homepage && `Live site: ${info.homepage}`,
    '',
    'README:',
    clip(readme || '(no README)', 30000),
  ];
  return { title: info.name, link: info.html_url, text: lines.filter((l) => l !== undefined && l !== false && l !== 0).join('\n') };
}

/** A project folder on this computer: README and docs, package info, languages and file layout. */
export async function folderToText(dir) {
  const root = path.resolve(String(dir || '').trim().replace(/^~(?=\/|$)/, process.env.HOME || '~'));
  let stat;
  try {
    stat = await fs.stat(root);
  } catch {
    throw httpError(404, `Folder not found: ${root}`);
  }
  if (!stat.isDirectory()) throw httpError(400, 'That path is a file. Use Upload for files, or give the folder that contains it.');

  const files = [];
  async function walk(d, depth) {
    if (files.length > 3000) return;
    const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && depth < 4) await walk(p, depth + 1);
      } else files.push(p);
    }
  }
  await walk(root, 0);

  const rel = (p) => path.relative(root, p);
  const langCount = {};
  for (const f of files) {
    const l = LANG[path.extname(f).toLowerCase()];
    if (l) langCount[l] = (langCount[l] || 0) + 1;
  }
  const docs = files
    .filter((f) => TEXT_EXT.test(f))
    .sort((a, b) => (/readme/i.test(path.basename(a)) ? -1 : 0) - (/readme/i.test(path.basename(b)) ? -1 : 0) || a.length - b.length)
    .slice(0, 6);
  let budget = 30000;
  const docText = [];
  for (const f of docs) {
    if (budget <= 0) break;
    const t = await fs.readFile(f, 'utf8').catch(() => '');
    docText.push(`### ${rel(f)}\n${clip(t, budget)}`);
    budget -= t.length;
  }
  let pkg = '';
  for (const name of ['package.json', 'pyproject.toml', 'requirements.txt', 'default.project.json']) {
    const t = await fs.readFile(path.join(root, name), 'utf8').catch(() => '');
    if (t) pkg += `### ${name}\n${clip(t, 3000)}\n`;
  }
  const newest = await Promise.all(files.slice(0, 400).map((f) => fs.stat(f).then((s) => s.mtimeMs).catch(() => 0)));
  const times = newest.filter(Boolean).sort();
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const tree = files.slice(0, 120).map(rel).join('\n');
  const text = [
    `Project folder: ${path.basename(root)}`,
    Object.keys(langCount).length && `Languages (by file count): ${Object.entries(langCount).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`).join(', ')}`,
    times.length && `Files dated from ${day(times[0])} to ${day(times[times.length - 1])}`,
    `${files.length} files. Layout:\n${tree}${files.length > 120 ? '\n...' : ''}`,
    pkg,
    docText.length ? docText.join('\n\n') : '(no README or docs found)',
  ];
  return { title: path.basename(root), text: text.filter(Boolean).join('\n\n') };
}
