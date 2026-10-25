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
export { githubToText } from './github.js';

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n[...cut to keep the prompt short]` : s);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
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
