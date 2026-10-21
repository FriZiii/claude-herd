#!/usr/bin/env node
// Waits until a file appears in any <herd-dir>/*/outbox/, prints one line per file and exits.
//   node herd-watch.mjs <herd-dir>
//   HERD_OUTBOX <absolute path>
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('Usage: node herd-watch.mjs <herd-dir>'); process.exit(2); }
const herd = resolve(dir);

function pending() {
  if (!existsSync(herd)) return [];
  const out = [];
  for (const f of readdirSync(herd)) {
    const outbox = join(herd, f, 'outbox');
    if (!existsSync(outbox)) continue;
    for (const name of readdirSync(outbox)) {
      const p = join(outbox, name);
      if (statSync(p).isFile()) out.push(p);
    }
  }
  return out.sort();
}

(function poll() {
  const files = pending();
  if (!files.length) return setTimeout(poll, 3000);
  for (const p of files) console.log(`HERD_OUTBOX ${p}`);
})();
