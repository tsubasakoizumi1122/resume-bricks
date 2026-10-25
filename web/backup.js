// Backups for the web version: a .zip with the same layout as my-data/
// (blocks/*.yaml, resumes/*.yaml, .trash/*.yaml), so it also drops straight into the local app.
import JSZip from 'jszip';
import YAML from 'yaml';
import { isValidId } from '../lib/ids.js';

const yaml = (doc) => {
  const { id, ...rest } = doc;
  return YAML.stringify(rest, { lineWidth: 0 });
};

export async function exportBackup(db) {
  const zip = new JSZip();
  const counts = {};
  for (const kind of ['blocks', 'resumes']) {
    const list = await db.list(kind);
    counts[kind] = list.length;
    for (const doc of list) zip.file(`${kind}/${doc.id}.yaml`, yaml(doc));
  }
  for (const [key, doc] of await db.trash()) zip.file(`.trash/${key}.yaml`, yaml(doc));
  zip.file(
    'README.txt',
    'Resume Bricks backup.\n\nRestore it in the web app with Restore, or unzip it into my-data/ to use it with the local app (npm start).\n',
  );
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const name = `resume-bricks-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  return { blob, name, counts };
}

/** Read a backup .zip (or a single .yaml brick) into { blocks: [{id, doc}], resumes: [...], skipped: [] }. */
export async function readBackup(file) {
  const out = { blocks: [], resumes: [], skipped: [] };
  const add = (kind, id, text, label) => {
    try {
      const doc = YAML.parse(text) ?? {};
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('not a YAML mapping');
      if (kind === 'blocks' && !doc.type) throw new Error('no type');
      out[kind].push({ id, doc });
    } catch (e) {
      out.skipped.push(`${label} (${e.message})`);
    }
  };
  if (/\.ya?ml$/i.test(file.name)) {
    const id = file.name.replace(/\.ya?ml$/i, '').toLowerCase();
    if (isValidId(id)) add('blocks', id, await file.text(), file.name);
    else out.skipped.push(file.name);
    return out;
  }
  let zip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error('That is not a Resume Bricks backup (.zip).');
  }
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || /(^|\/)(\.trash|__MACOSX)\//.test(name)) continue;
    const m = name.match(/(?:^|\/)(blocks|resumes)\/([^/]+)\.ya?ml$/);
    if (!m) continue;
    if (!isValidId(m[2])) {
      out.skipped.push(name);
      continue;
    }
    add(m[1], m[2], await entry.async('string'), name);
  }
  if (!out.blocks.length && !out.resumes.length) throw new Error('No bricks or resumes found in that file.');
  return out;
}
