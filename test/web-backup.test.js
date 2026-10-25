// The web version's backup .zip: what goes out comes back in, laid out like my-data/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { exportBackup, readBackup } from '../web/backup.js';

const fakeDb = {
  async list(kind) {
    return kind === 'blocks'
      ? [{ id: 'experience-acme', type: 'experience', org: 'Acme', bullets: ['Did a thing'] }, { id: 'header-me', type: 'header', name: 'Me' }]
      : [{ id: 'my-resume', name: 'My resume', header: 'header-me', sections: [{ title: 'Experience', items: [{ block: 'experience-acme' }] }] }];
  },
  async trash() {
    return [['blocks-old-2026-01-01T00-00-00-000Z', { type: 'skills', label: 'Old' }]];
  },
};

test('backup round-trip keeps every brick and resume', async () => {
  const { blob, name, counts } = await exportBackup(fakeDb);
  assert.match(name, /^resume-bricks-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  assert.deepEqual(counts, { blocks: 2, resumes: 1 });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.ok(zip.file('blocks/experience-acme.yaml'), 'same layout as my-data/');
  assert.ok(zip.file('.trash/blocks-old-2026-01-01T00-00-00-000Z.yaml'));
  assert.doesNotMatch(await zip.file('blocks/header-me.yaml').async('string'), /^id:/m, 'ids live in file names');

  const back = await readBackup(new File([blob], name));
  assert.deepEqual(back.blocks.map((b) => b.id).sort(), ['experience-acme', 'header-me']);
  assert.equal(back.resumes[0].doc.sections[0].items[0].block, 'experience-acme');
  assert.deepEqual(back.skipped, []);
});

test('restore reads a zipped my-data folder and rejects other files', async () => {
  const zip = new JSZip();
  zip.file('my-data/blocks/skills-tools.yaml', 'type: skills\nlabel: Tools\nitems: [Excel]\n');
  zip.file('my-data/blocks/Bad Name.yaml', 'type: skills\n');
  zip.file('my-data/.trash/blocks-x.yaml', 'type: skills\n');
  zip.file('__MACOSX/my-data/blocks/._skills-tools.yaml', 'junk');
  const out = await readBackup(new File([await zip.generateAsync({ type: 'uint8array' })], 'my-data.zip'));
  assert.deepEqual(out.blocks.map((b) => b.id), ['skills-tools']);
  assert.equal(out.skipped.length, 1);
  await assert.rejects(readBackup(new File(['hello'], 'notes.zip')), /not a Resume Bricks backup/);
});
