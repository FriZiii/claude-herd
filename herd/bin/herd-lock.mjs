#!/usr/bin/env node
// Heavy-build lock: at most one full suite / app build per repo at a time.
//   node herd-lock.mjs acquire <herd-dir> <agent>   waits, then prints HERD_LOCK_ACQUIRED
//   node herd-lock.mjs release <herd-dir> <agent>
import { openSync, writeSync, closeSync, readFileSync, unlinkSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [cmd, dir, agent] = process.argv.slice(2);
if (!['acquire', 'release'].includes(cmd) || !dir || !agent) {
  console.error('Usage: node herd-lock.mjs acquire|release <herd-dir> <agent>');
  process.exit(2);
}
const lock = join(resolve(dir), 'heavy.lock');
const STALE_MS = 60 * 60 * 1000;

function holder() {
  try { return JSON.parse(readFileSync(lock, 'utf8')); } catch { return null; }
}

if (cmd === 'release') {
  const h = holder();
  if (h && h.agent !== agent) { console.error(`HERD_LOCK_NOT_OWNER held by ${h.agent}`); process.exit(1); }
  try { unlinkSync(lock); } catch {}
  console.log('HERD_LOCK_RELEASED');
  process.exit(0);
}

mkdirSync(resolve(dir), { recursive: true });
(function tryAcquire() {
  try {
    const fd = openSync(lock, 'wx');
    writeSync(fd, JSON.stringify({ agent, at: new Date().toISOString(), pid: process.pid }));
    closeSync(fd);
    console.log('HERD_LOCK_ACQUIRED');
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let age = 0;
    try { age = Date.now() - statSync(lock).mtimeMs; } catch { return tryAcquire(); }
    if (age > STALE_MS) {
      console.error(`HERD_LOCK_STALE removed lock of ${holder()?.agent ?? '?'}`);
      try { unlinkSync(lock); } catch {}
      return tryAcquire();
    }
    setTimeout(tryAcquire, 10000);
  }
})();
