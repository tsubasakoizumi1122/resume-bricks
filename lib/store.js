// File-based storage: one YAML file per brick / per resume.
// The filename (without extension) is the id and the single source of truth.
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import YAML from 'yaml';

export { isValidId, slugify } from './ids.js';
import { isValidId, slugify } from './ids.js';

export const KINDS = ['blocks', 'resumes'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Copy sample data into a fresh data dir on first run. Returns true if seeded. */
export async function initDataDir(dataDir, sampleDir) {
  try {
    await fs.access(dataDir);
    return false;
  } catch {
    /* does not exist yet */
  }
  try {
    await fs.cp(sampleDir, dataDir, { recursive: true });
    return true;
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
    return false;
  }
}

export function createStore(dataDir) {
  const dirs = {
    blocks: path.join(dataDir, 'blocks'),
    resumes: path.join(dataDir, 'resumes'),
    trash: path.join(dataDir, '.trash'),
  };

  function dirFor(kind) {
    if (!KINDS.includes(kind)) throw new HttpError(404, `unknown kind: ${kind}`);
    return dirs[kind];
  }

  function checkId(id) {
    if (!isValidId(id)) {
      throw new HttpError(400, 'invalid id (use lowercase letters, numbers, - and _)');
    }
  }

  async function findFile(kind, id) {
    const dir = dirFor(kind);
    for (const ext of ['.yaml', '.yml']) {
      const p = path.join(dir, id + ext);
      try {
        await fs.access(p);
        return p;
      } catch {
        /* try next */
      }
    }
    return null;
  }

  function clean(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new HttpError(400, 'body must be a JSON object');
    }
    const { id, ...rest } = obj; // id lives in the filename
    return rest;
  }

  // Writes to one kind run one at a time, so a create can't pick an id another
  // request is about to take, and two saves of the same file can't interleave.
  const queues = new Map();
  function serial(kind, fn) {
    const prev = queues.get(kind) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    queues.set(kind, run.catch(() => {}));
    return run;
  }

  async function writeAtomic(file, doc) {
    // Unique per write, so concurrent writes never share a temp file.
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, YAML.stringify(doc, { lineWidth: 0 }), 'utf8');
    await fs.rename(tmp, file);
  }

  return {
    dirs,

    async ensure() {
      for (const d of Object.values(dirs)) await fs.mkdir(d, { recursive: true });
    },

    async list(kind) {
      const dir = dirFor(kind);
      const files = (await fs.readdir(dir)).filter((f) => /\.ya?ml$/.test(f)).sort();
      const out = [];
      for (const f of files) {
        const id = f.replace(/\.ya?ml$/, '');
        if (!isValidId(id)) continue;
        try {
          const doc = YAML.parse(await fs.readFile(path.join(dir, f), 'utf8')) ?? {};
          out.push({ ...doc, id });
        } catch (e) {
          out.push({ id, type: '_error', error: `${f}: ${e.message}` });
        }
      }
      return out;
    },

    async get(kind, id) {
      checkId(id);
      const file = await findFile(kind, id);
      if (!file) throw new HttpError(404, `${kind}/${id} not found`);
      const doc = YAML.parse(await fs.readFile(file, 'utf8')) ?? {};
      return { ...doc, id };
    },

    async put(kind, id, obj) {
      checkId(id);
      const doc = clean(obj);
      const dir = dirFor(kind);
      return serial(kind, async () => {
        const file = (await findFile(kind, id)) ?? path.join(dir, id + '.yaml');
        await writeAtomic(file, doc);
        return { id };
      });
    },

    async create(kind, obj, hint) {
      const doc = clean(obj);
      const dir = dirFor(kind);
      const base = slugify(hint);
      return serial(kind, async () => {
        let id = base;
        for (let n = 2; await findFile(kind, id); n++) id = `${base}-${n}`;
        await writeAtomic(path.join(dir, id + '.yaml'), doc);
        return { id };
      });
    },

    /** Soft delete: moves the file into .trash/ so nothing is ever lost by accident. */
    async remove(kind, id) {
      checkId(id);
      dirFor(kind);
      return serial(kind, async () => {
        const file = await findFile(kind, id);
        if (!file) throw new HttpError(404, `${kind}/${id} not found`);
        await fs.mkdir(dirs.trash, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        await fs.rename(file, path.join(dirs.trash, `${kind}-${id}-${stamp}${path.extname(file)}`));
        return { ok: true };
      });
    },
  };
}
