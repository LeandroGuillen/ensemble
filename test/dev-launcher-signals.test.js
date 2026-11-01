/**
 * Dev launchers forward SIGTERM/SIGINT/SIGHUP to their children.
 *
 * Uses fakes only (fake ng, wait-on and Electron via ENSEMBLE_ELECTRON_BIN);
 * never launches the real Electron or ng serve.
 * Run with: node --test test/dev-launcher-signals.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { forwardSignals, supervise } = require('../lib/forward-signals');

const repo = path.join(__dirname, '..');
const posix = process.platform !== 'win32';

function fakeChild() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.pid = 4242;
  child.killed = [];
  child.kill = (signal) => child.killed.push(signal);
  return child;
}

function fakeProc() {
  const proc = new EventEmitter();
  proc.pid = 1;
  proc.calls = [];
  proc.kill = (pid, signal) => proc.calls.push(['kill', pid, signal]);
  proc.exit = (code) => proc.calls.push(['exit', code]);
  return proc;
}

describe('forwardSignals / supervise (unit)', () => {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    it(`forwards ${signal} to the child`, () => {
      const child = fakeChild();
      const proc = fakeProc();
      forwardSignals(child, { proc, platform: 'linux' });
      proc.emit(signal);
      assert.deepEqual(child.killed, [signal]);
    });
  }

  it('does not signal a child that already exited', () => {
    const child = fakeChild();
    const proc = fakeProc();
    forwardSignals(child, { proc, platform: 'linux' });
    child.exitCode = 0;
    proc.emit('SIGTERM');
    assert.deepEqual(child.killed, []);
  });

  it('uses taskkill /T on Windows', () => {
    const child = fakeChild();
    const proc = fakeProc();
    const calls = [];
    forwardSignals(child, { proc, platform: 'win32', spawnSync: (...a) => calls.push(a) });
    proc.emit('SIGTERM');
    assert.deepEqual(child.killed, []);
    assert.deepEqual(calls[0].slice(0, 2), ['taskkill', ['/pid', '4242', '/T', '/F']]);
  });

  it('supervise mirrors the exit code and removes handlers before re-raising a signal', () => {
    const child = fakeChild();
    const proc = fakeProc();
    supervise(child, { proc, platform: 'linux' });
    assert.equal(proc.listenerCount('SIGTERM'), 1);
    child.emit('exit', null, 'SIGTERM');
    assert.equal(proc.listenerCount('SIGTERM'), 0, 're-raised signal must use the default action');
    assert.deepEqual(proc.calls, [['kill', 1, 'SIGTERM'], ['exit', 1]]);

    const child2 = fakeChild();
    const proc2 = fakeProc();
    supervise(child2, { proc: proc2, platform: 'linux' });
    child2.emit('exit', 3, null);
    assert.deepEqual(proc2.calls, [['exit', 3]]);
  });
});

/** All descendant pids of `root` (ps-based; POSIX only). */
function descendants(root) {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' });
  const kids = new Map();
  for (const line of out.trim().split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  const result = [];
  const stack = [root];
  while (stack.length) {
    for (const k of kids.get(stack.pop()) || []) {
      result.push(k);
      stack.push(k);
    }
  }
  return result;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(pred, ms, label) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`timed out waiting for ${label}`);
}

function writeExecutable(file, body) {
  fs.writeFileSync(file, `#!${process.execPath}\n${body}\n`);
  fs.chmodSync(file, 0o755);
}

describe('dev launchers with fakes (real processes)', { skip: !posix && 'POSIX only' }, () => {
  let root;
  let pidDir;
  let fakeElectron;
  /** Every fake process seen, killed in after() if a failing test left it running. */
  const seen = new Set();

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-launcher-'));
    pidDir = path.join(root, 'pids');
    fs.mkdirSync(pidDir);
    for (const dir of ['scripts', 'lib', 'node_modules/.bin']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    for (const f of ['scripts/electron-dev.js', 'scripts/run-electron.js', 'lib/dev-server.js', 'lib/forward-signals.js']) {
      fs.copyFileSync(path.join(repo, f), path.join(root, f));
    }
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"launcher-fixture","version":"0.0.0","private":true}');
    // Real concurrently, fake everything it runs.
    fs.symlinkSync(path.join(repo, 'node_modules', 'concurrently'), path.join(root, 'node_modules', 'concurrently'));
    fs.symlinkSync('../concurrently/dist/bin/concurrently.js', path.join(root, 'node_modules', '.bin', 'concurrently'));
    const sleeper = (name) =>
      `require('fs').writeFileSync(${JSON.stringify(pidDir)} + '/${name}.' + process.pid, '');\n` +
      `if (process.env.FAKE_EXIT_CODE) process.exit(Number(process.env.FAKE_EXIT_CODE));\n` +
      `setInterval(() => {}, 1000);`;
    writeExecutable(path.join(root, 'node_modules', '.bin', 'ng'), sleeper('ng'));
    writeExecutable(path.join(root, 'node_modules', '.bin', 'wait-on'), 'process.exit(0);');
    fakeElectron = path.join(root, 'fake-electron');
    writeExecutable(fakeElectron, sleeper('electron'));
  });

  after(() => {
    for (const f of fs.readdirSync(pidDir)) seen.add(Number(f.split('.')[1]));
    for (const pid of seen) {
      if (alive(pid)) process.kill(pid, 'SIGKILL');
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  function pidsOf(name) {
    return fs.readdirSync(pidDir).filter((f) => f.startsWith(`${name}.`)).map((f) => Number(f.split('.')[1]));
  }

  function clearPids() {
    for (const f of fs.readdirSync(pidDir)) {
      seen.add(Number(f.split('.')[1]));
      fs.rmSync(path.join(pidDir, f));
    }
  }

  function launch(script, extraEnv = {}) {
    const child = spawn(process.execPath, [path.join(root, 'scripts', script)], {
      cwd: root,
      stdio: 'ignore',
      env: { ...process.env, ENSEMBLE_ELECTRON_BIN: fakeElectron, ENSEMBLE_DEV_PORT: '4999', ...extraEnv },
    });
    const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
    return { child, exited };
  }

  it('kill -TERM run-electron.js terminates the electron child', async () => {
    clearPids();
    const { child, exited } = launch('run-electron.js');
    await waitFor(() => pidsOf('electron').length === 1, 10_000, 'fake electron');
    const [electronPid] = pidsOf('electron');
    process.kill(child.pid, 'SIGTERM');
    const result = await exited;
    assert.equal(result.signal, 'SIGTERM');
    await waitFor(() => !alive(electronPid), 5_000, 'electron to exit');
  });

  it('run-electron.js exits with the child exit code', async () => {
    clearPids();
    const { exited } = launch('run-electron.js', { FAKE_EXIT_CODE: '3' });
    assert.deepEqual(await exited, { code: 3, signal: null });
  });

  it('kill -TERM electron-dev.js (npm start) leaves no concurrently, ng or electron', { timeout: 60_000 }, async () => {
    clearPids();
    const { child, exited } = launch('electron-dev.js');
    await waitFor(() => pidsOf('electron').length === 1 && pidsOf('ng').length === 1, 30_000, 'fake ng + electron');
    const tree = descendants(child.pid);
    for (const pid of tree) seen.add(pid);
    assert.ok(tree.length >= 3, `expected npx/concurrently/ng/electron below the launcher, got ${tree}`);
    for (const pid of [...pidsOf('ng'), ...pidsOf('electron')]) assert.ok(tree.includes(pid));

    process.kill(child.pid, 'SIGTERM');
    await exited;
    await waitFor(() => tree.every((pid) => !alive(pid)), 5_000, `no orphans (left: ${tree.filter(alive)})`);
  });
});
