#!/usr/bin/env node
// Run the app on a throwaway copy of the fictional sample data.
// Your own my-data/ is never read or written, and nothing you do here is kept.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'resume-bricks-demo-'));
rmSync(dir, { recursive: true }); // the server seeds sample data into a dir that doesn't exist yet
process.env.RESUME_DATA = dir;
process.env.PORT ||= '4322'; // so it can run next to your real copy on 4321

const cleanup = () => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
};
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));

console.log('\n  🎭 Demo mode: fictional sample data, nothing is saved.');
await import('../server.js');
