/**
 * Dev launcher helper: forward termination signals from a wrapper process to the
 * child it spawned, then let the wrapper exit with the child's code or signal.
 *
 * Without this, `kill -TERM <npm start pid>` (an IDE stop button, a process
 * manager) kills only the node wrapper and orphans concurrently, ng serve (still
 * holding the dev port) and Electron. Ctrl-C works either way because the whole
 * process group gets SIGINT.
 *
 * On POSIX the signal goes to the whole process tree, not just the direct child:
 * npm 11's `npm exec` (npx) runs the command through `sh -c`, and where /bin/sh is
 * dash (Debian, Ubuntu, CI) that shell stays in between. npm signals the shell,
 * the shell dies, and concurrently, ng serve and Electron never see the signal.
 */

const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * All descendants of `rootPid` from one `ps` snapshot (POSIX; Linux and macOS ps).
 * Returns [] if ps is unavailable.
 * @param {number} rootPid
 * @param {typeof import('child_process').execFileSync} [execFileSync]
 * @returns {number[]}
 */
function descendantPids(rootPid, execFileSync = require('child_process').execFileSync) {
  let out;
  try {
    out = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return [];
  }
  const children = new Map();
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const result = [];
  const stack = [rootPid];
  while (stack.length) {
    for (const pid of children.get(stack.pop()) || []) {
      result.push(pid);
      stack.push(pid);
    }
  }
  return result;
}

/**
 * @param {import('child_process').ChildProcess} child
 * @param {{
 *   proc?: NodeJS.Process,
 *   platform?: string,
 *   spawnSync?: typeof import('child_process').spawnSync,
 *   signals?: string[],
 *   listDescendants?: (pid: number) => number[],
 *   killPid?: (pid: number, signal: string) => void,
 * }} [options]
 * @returns {() => void} removes the handlers (call before re-raising a signal on yourself)
 */
function forwardSignals(child, options = {}) {
  const proc = options.proc || process;
  const platform = options.platform || process.platform;
  const signals = options.signals || FORWARDED_SIGNALS;
  const spawnSync = options.spawnSync || require('child_process').spawnSync;
  const listDescendants = options.listDescendants || ((pid) => descendantPids(pid));
  const killPid = options.killPid || ((pid, signal) => process.kill(pid, signal));

  const handlers = signals.map((signal) => {
    const handler = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (platform === 'win32' && child.pid) {
        // shell:true children are a cmd.exe tree; signals don't reach it.
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        return;
      }
      // Snapshot the tree first: once a parent dies its children are reparented
      // and can no longer be found under the child.
      const tree = child.pid ? listDescendants(child.pid) : [];
      try {
        child.kill(signal);
      } catch {
        // Child already gone.
      }
      for (const pid of tree) {
        try {
          killPid(pid, signal);
        } catch {
          // Already exited.
        }
      }
    };
    proc.on(signal, handler);
    return [signal, handler];
  });

  return () => {
    for (const [signal, handler] of handlers) {
      proc.removeListener(signal, handler);
    }
  };
}

/**
 * Wire `child` to the wrapper: forward signals in, and mirror its exit out
 * (re-raise the child's signal on ourselves, else exit with its code).
 *
 * @param {import('child_process').ChildProcess} child
 * @param {Parameters<typeof forwardSignals>[1]} [options]
 */
function supervise(child, options = {}) {
  const proc = options.proc || process;
  const dispose = forwardSignals(child, options);
  child.on('exit', (code, signal) => {
    dispose();
    if (signal) proc.kill(proc.pid, signal);
    proc.exit(code ?? 1);
  });
  return dispose;
}

module.exports = { FORWARDED_SIGNALS, descendantPids, forwardSignals, supervise };
