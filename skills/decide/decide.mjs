#!/usr/bin/env node
// decide: a persistent tab with the agent's questions. One server per session dir.
//   node decide.mjs ask  <dir> <questions.json>  adds questions; starts the server and opens the tab when none is connected
//   node decide.mjs wait <dir>                   waits for submitted groups, prints the answers and exits
//   node decide.mjs done <dir> <groupId>...      marks groups as done
//   node decide.mjs stop <dir>                   stops the server (the tab shows "Session ended")
//   node decide.mjs serve <dir>                  the server process, started by ask
import http from 'node:http';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const USAGE = 'Usage: node decide.mjs <ask|wait|done|stop> <session-dir> [questions.json | groupId...]';
const IDLE_LIMIT_MS = 4 * 60 * 60 * 1000;

const [cmd, dirArg, ...rest] = process.argv.slice(2);
if (!cmd || !dirArg) fail(USAGE);
const dir = resolve(dirArg);
mkdirSync(dir, { recursive: true });
const infoPath = join(dir, 'server.json');

switch (cmd) {
  case 'serve': serve(); break;
  case 'ask': await ask(rest[0]); break;
  case 'wait': await wait(); break;
  case 'done': await done(rest); break;
  case 'stop': await stop(); break;
  default: fail(USAGE);
}

// ---------- client ----------

async function ask(file) {
  if (!file) fail('Give the path to questions.json.');
  let payload;
  try {
    payload = JSON.parse(readFileSync(resolve(file), 'utf8'));
  } catch (e) {
    fail(`Cannot read ${file}: ${e.message}`);
  }
  const port = await ensureServer();
  const r = await call(port, 'POST', '/api/ask', payload);
  if (!r.json.ok) fail(`Errors in ${file}:\n- ${r.json.errors.join('\n- ')}`);
  out(`DECIDE_URL ${r.json.url}`);
  out(r.json.opened ? 'Opened the tab in the browser.' : 'The tab is already open; the questions appeared in it.');
  out(`Added ${r.json.added} question(s) to groups: ${r.json.groups.join(', ')}`);
}

async function wait() {
  const port = await findServer();
  if (!port) fail('No decide server is running in this dir. Run `ask` first.');
  const r = await call(port, 'GET', '/api/wait');
  if (r.json.stopped) {
    out('DECIDE_STOPPED the server was stopped; no new answers.');
    return;
  }
  const subs = r.json.submissions;
  out(`DECIDE_SUBMITTED ${subs.map((s) => s.group).join(',')} answers=${join(dir, 'answers.jsonl')}`);
  for (const s of subs) out('\n' + s.text);
}

async function done(groups) {
  if (!groups.length) fail('Give the group ids.');
  const port = await findServer();
  if (!port) fail('No decide server is running in this dir.');
  const r = await call(port, 'POST', '/api/done', { groups });
  if (!r.json.ok) fail(r.json.errors.join('\n'));
  out(`Done: ${groups.join(', ')}`);
}

async function stop() {
  const port = await findServer();
  if (!port) return out('The decide server is not running.');
  await call(port, 'POST', '/api/stop');
  out('Decide server stopped.');
}

async function findServer() {
  if (!existsSync(infoPath)) return null;
  try {
    const { port } = JSON.parse(readFileSync(infoPath, 'utf8'));
    const r = await call(port, 'GET', '/api/ping');
    return r.json.ok ? port : null;
  } catch {
    return null;
  }
}

async function ensureServer() {
  const running = await findServer();
  if (running) return running;
  if (existsSync(infoPath)) unlinkSync(infoPath);
  spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', dir], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const port = await findServer();
    if (port) return port;
  }
  fail(`The decide server did not start. Check ${join(dir, 'server.log')}.`);
}

function call(port, method, path, body) {
  return new Promise((res, rej) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        try { res({ status: r.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (e) { rej(e); }
      });
    });
    req.on('error', rej);
    if (data) req.write(data);
    req.end();
  });
}

function out(line) { process.stdout.write(line + '\n'); }
function fail(message) { process.stderr.write(message + '\n'); process.exit(2); }

// ---------- server ----------

function serve() {
  const page = () => readFileSync(join(here, 'form.html')); // read per request, so template changes apply without a restart
  const marked = readFileSync(join(here, 'marked.min.js'));
  const logPath = join(dir, 'server.log');
  const log = (m) => appendFileSync(logPath, `${new Date().toISOString()} ${m}\n`);

  const state = { title: null, groups: [] }; // group: { id, label, description, status: open|processing|done, questions, history }
  let rev = 0;
  const queue = [];    // submitted groups not yet collected by `wait`
  const waiters = [];  // open `wait` requests
  const clients = new Set();
  let lastActivity = Date.now();
  let lastOpen = 0;
  let url;

  const server = http.createServer(async (req, res) => {
    try {
      const path = req.url.split('?')[0];
      if (req.method === 'GET' && path === '/') return send(res, 200, 'text/html; charset=utf-8', page());
      if (req.method === 'GET' && path === '/marked.min.js') return send(res, 200, 'text/javascript; charset=utf-8', marked);
      if (req.method === 'GET' && path === '/api/ping') return json(res, 200, { ok: true });
      if (req.method === 'GET' && path === '/api/events') return events(req, res);
      if (req.method === 'GET' && path === '/api/wait') { lastActivity = Date.now(); return addWaiter(req, res); }
      if (req.method === 'POST') {
        lastActivity = Date.now();
        const body = await readBody(req);
        if (path === '/api/ask') return json(res, 200, onAsk(body));
        if (path === '/api/submit') return json(res, 200, onSubmit(body));
        if (path === '/api/done') return json(res, 200, onDone(body));
        if (path === '/api/stop') { json(res, 200, { ok: true }); return shutdown('stop'); }
      }
      send(res, 404, 'text/plain; charset=utf-8', 'Not found.');
    } catch (e) {
      log(`error: ${e.stack}`);
      json(res, 400, { ok: false, errors: [e.message] });
    }
  });
  server.requestTimeout = 0;

  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    url = `http://127.0.0.1:${port}/`;
    writeFileSync(infoPath, JSON.stringify({ port, pid: process.pid }), 'utf8');
    log(`start ${url}`);
  });

  setInterval(() => {
    for (const c of clients) c.write(': ping\n\n');
    if (Date.now() - lastActivity > IDLE_LIMIT_MS) shutdown('4 h without activity');
  }, 25_000).unref();

  function events(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    clients.add(res);
    res.write(`data: ${JSON.stringify({ type: 'state', state })}\n\n`);
    req.on('close', () => clients.delete(res));
  }

  function broadcast(msg) {
    const line = `data: ${JSON.stringify(msg)}\n\n`;
    for (const c of clients) c.write(line);
  }

  function onAsk(p) {
    const errors = [];
    if (!p || typeof p !== 'object') return { ok: false, errors: ['the file must contain a JSON object'] };
    if (!Array.isArray(p.questions) || p.questions.length === 0) errors.push('"questions" must be a non-empty array');
    for (const g of p.groups ?? []) {
      if (!g.id || !g.label) errors.push(`group without "id" or "label": ${JSON.stringify(g)}`);
      if (g.source != null && (typeof g.source !== 'object' || !g.source.type)) errors.push(`group ${g.id}: "source" must be an object with a "type" field`);
    }
    const known = new Set([...state.groups.map((g) => g.id), ...(p.groups ?? []).map((g) => g.id)]);
    const fallbackGroup = !(p.groups ?? []).length;
    const seen = new Set();
    for (const q of p.questions ?? []) {
      if (fallbackGroup && !q.group) q.group = 'main';
      errors.push(...validateQuestion(q, seen));
      if (q.group !== 'main' && !known.has(q.group)) errors.push(`question ${q.id}: group "${q.group}" does not exist (add it to "groups")`);
    }
    if (errors.length) return { ok: false, errors };

    if (p.title) state.title = p.title;
    const upsert = (g) => {
      let cur = state.groups.find((x) => x.id === g.id);
      if (!cur) state.groups.push((cur = { id: g.id, label: g.label, description: g.description ?? null, source: g.source ?? null, status: 'open', questions: [], history: [] }));
      if (g.label) cur.label = g.label;
      if (g.description !== undefined) cur.description = g.description;
      if (g.source !== undefined) cur.source = g.source;
      return cur;
    };
    for (const g of p.groups ?? []) upsert(g);
    const touched = new Set();
    for (const q of p.questions) {
      const g = state.groups.find((x) => x.id === q.group) ?? upsert({ id: 'main', label: p.title || 'Questions' });
      const item = { ...q, rev: ++rev };
      const i = g.questions.findIndex((x) => x.id === q.id);
      if (i >= 0) g.questions[i] = item; else g.questions.push(item);
      g.status = 'open';
      touched.add(g.id);
    }
    broadcast({ type: 'state', state });
    let opened = false;
    if (clients.size === 0 && Date.now() - lastOpen > 15_000) {
      openBrowser(url);
      lastOpen = Date.now();
      opened = true;
    }
    return { ok: true, url, opened, added: p.questions.length, groups: [...touched] };
  }

  function onSubmit(p) {
    const subs = [];
    for (const s of p.groups ?? []) {
      const g = state.groups.find((x) => x.id === s.group);
      if (!g) continue;
      const at = new Date().toISOString();
      // The full question stays in the history, so the tab can show a done group as it looked.
      g.history.push({ at, items: s.answers.map((a) => ({ id: a.id, title: a.title, answer: a.line, note: a.note, question: g.questions.find((q) => q.id === a.id) ?? null, result: a })) });
      g.questions = [];
      g.status = 'processing';
      const sub = { group: g.id, label: g.label, at, answers: s.answers, text: s.text };
      appendFileSync(join(dir, 'answers.jsonl'), JSON.stringify(sub) + '\n', 'utf8');
      subs.push(sub);
    }
    queue.push(...subs);
    broadcast({ type: 'state', state });
    flushWaiters();
    return { ok: true, submitted: subs.map((s) => s.group) };
  }

  function onDone(p) {
    const missing = (p.groups ?? []).filter((id) => !state.groups.some((g) => g.id === id));
    if (missing.length) return { ok: false, errors: [`unknown groups: ${missing.join(', ')}`] };
    for (const g of state.groups) if (p.groups.includes(g.id) && !g.questions.length) g.status = 'done';
    broadcast({ type: 'state', state });
    return { ok: true };
  }

  function addWaiter(req, res) {
    waiters.push(res);
    req.on('close', () => { const i = waiters.indexOf(res); if (i >= 0) waiters.splice(i, 1); });
    flushWaiters();
  }

  // Answers leave the queue only once `wait` has actually received them.
  function flushWaiters() {
    while (queue.length && waiters.length) {
      const res = waiters.shift();
      if (res.destroyed) continue;
      const batch = queue.splice(0);
      res.on('close', () => { if (!res.writableFinished) queue.unshift(...batch); });
      json(res, 200, { submissions: batch });
    }
  }

  function shutdown(reason) {
    log(`stop: ${reason}`);
    broadcast({ type: 'stopped' });
    for (const w of waiters.splice(0)) json(w, 200, { stopped: true });
    try { unlinkSync(infoPath); } catch {}
    setTimeout(() => process.exit(0), 300);
  }
}

function validateQuestion(q, seen) {
  const out = [];
  const where = `question ${q.id ?? '(no id)'}`;
  if (!q.id) out.push(`${where}: missing "id"`);
  if (seen.has(q.id)) out.push(`${where}: duplicate "id"`);
  seen.add(q.id);
  if (!q.title) out.push(`${where}: missing "title"`);
  if (!['single', 'multi', 'bool', 'text'].includes(q.type)) out.push(`${where}: "type" must be single | multi | bool | text`);
  if (q.type === 'single' || q.type === 'multi') {
    if (!Array.isArray(q.options) || q.options.length < 2) return [...out, `${where}: "options" needs at least 2 options`];
    const ids = new Set(q.options.map((o) => o.id));
    for (const o of q.options) if (!o.id || !o.label) out.push(`${where}: option without "id" or "label"`);
    const rec = q.recommended == null ? [] : [].concat(q.recommended);
    for (const r of rec) if (!ids.has(r)) out.push(`${where}: "recommended" points to a nonexistent option "${r}"`);
    if (q.type === 'single' && rec.length > 1) out.push(`${where}: single takes one recommendation`);
  }
  if (q.type === 'bool' && q.recommended != null && typeof q.recommended !== 'boolean') out.push(`${where}: "recommended" for bool is true/false`);
  return out;
}

function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { res(raw ? JSON.parse(raw) : {}); } catch { rej(new Error('Invalid JSON.')); }
    });
    req.on('error', rej);
  });
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
function json(res, status, obj) { send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj)); }

function chromePath() {
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  return roots.map((r) => join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')).find((p) => existsSync(p));
}

function openBrowser(url) {
  if (process.env.DECIDE_NO_OPEN) return; // tests
  const chrome = process.platform === 'win32' ? chromePath() : null;
  const [c, a] =
    chrome ? [chrome, [url]]
    : process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', ['-a', 'Google Chrome', url]]
    : ['xdg-open', [url]];
  spawn(c, a, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}
