// The web version's storage: the same bricks and resumes as my-data/, kept in this
// browser's IndexedDB instead of YAML files. Nothing is sent anywhere.
import { isValidId, slugify } from '../lib/ids.js';

const DB_NAME = 'resume-bricks';
const STORES = ['blocks', 'resumes', 'trash', 'meta'];

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function open() {
  const r = indexedDB.open(DB_NAME, 1);
  r.onupgradeneeded = () => {
    for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
  };
  return req(r);
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createDb() {
  const ready = open();
  // One write at a time, like the local server, so ids never collide.
  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  async function tx(store, mode, fn) {
    const db = await ready;
    const t = db.transaction(store, mode);
    const out = await fn(t.objectStore(store));
    await new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Saving was cancelled by the browser.'));
    });
    return out;
  }

  const kindOk = (kind) => {
    if (kind !== 'blocks' && kind !== 'resumes') throw new HttpError(404, `unknown kind: ${kind}`);
  };
  const idOk = (id) => {
    if (!isValidId(id)) throw new HttpError(400, 'invalid id (use lowercase letters, numbers, - and _)');
  };
  const clean = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new HttpError(400, 'body must be a JSON object');
    const { id, ...rest } = obj;
    return structuredClone(rest);
  };

  return {
    ready,

    async getMeta(key) {
      return tx('meta', 'readonly', (s) => req(s.get(key)));
    },
    async setMeta(key, value) {
      return tx('meta', 'readwrite', (s) => req(s.put(value, key)));
    },

    async list(kind) {
      kindOk(kind);
      return tx(kind, 'readonly', async (s) => {
        const [keys, values] = await Promise.all([req(s.getAllKeys()), req(s.getAll())]);
        return keys.map((id, i) => ({ ...values[i], id })).sort((a, b) => (a.id < b.id ? -1 : 1));
      });
    },

    async get(kind, id) {
      kindOk(kind);
      idOk(id);
      const doc = await tx(kind, 'readonly', (s) => req(s.get(id)));
      if (!doc) throw new HttpError(404, `${kind}/${id} not found`);
      return { ...doc, id };
    },

    put(kind, id, obj) {
      kindOk(kind);
      idOk(id);
      const doc = clean(obj);
      return serial(() => tx(kind, 'readwrite', (s) => req(s.put(doc, id))).then(() => ({ id })));
    },

    create(kind, obj, hint) {
      kindOk(kind);
      const doc = clean(obj);
      const base = slugify(hint);
      return serial(() =>
        tx(kind, 'readwrite', async (s) => {
          const taken = new Set(await req(s.getAllKeys()));
          let id = base;
          for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
          await req(s.put(doc, id));
          return { id };
        }),
      );
    },

    /** Soft delete, like my-data/.trash: kept in the browser and included in backups. */
    remove(kind, id) {
      kindOk(kind);
      idOk(id);
      return serial(async () => {
        const doc = await tx(kind, 'readonly', (s) => req(s.get(id)));
        if (!doc) throw new HttpError(404, `${kind}/${id} not found`);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        await tx('trash', 'readwrite', (s) => req(s.put(doc, `${kind}-${id}-${stamp}`)));
        await tx(kind, 'readwrite', (s) => req(s.delete(id)));
        return { ok: true };
      });
    },

    async trash() {
      return tx('trash', 'readonly', async (s) => {
        const [keys, values] = await Promise.all([req(s.getAllKeys()), req(s.getAll())]);
        return keys.map((k, i) => [k, values[i]]);
      });
    },
  };
}
