/**
 * Dev launcher helper: forward termination signals from a wrapper process to the
 * child it spawned, then let the wrapper exit with the child's code or signal.
 *
 * Without this, `kill -TERM <npm start pid>` (an IDE stop button, a process
 * manager) kills only the node wrapper and orphans concurrently, ng serve (still
 * holding the dev port) and Electron. Ctrl-C works either way because the whole
 * process group gets SIGINT.
 */

const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * @param {import('child_process').ChildProcess} child
 * @param {{
 *   proc?: NodeJS.Process,
 *   platform?: string,
 *   spawnSync?: typeof import('child_process').spawnSync,
 *   signals?: string[],
 * }} [options]
 * @returns {() => void} removes the handlers (call before re-raising a signal on yourself)
 */
function forwardSignals(child, options = {}) {
  const proc = options.proc || process;
  const platform = options.platform || process.platform;
  const signals = options.signals || FORWARDED_SIGNALS;
  const spawnSync = options.spawnSync || require('child_process').spawnSync;

  const handlers = signals.map((signal) => {
    const handler = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (platform === 'win32' && child.pid) {
        // shell:true children are a cmd.exe tree; signals don't reach it.
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        return;
      }
      try {
        child.kill(signal);
      } catch {
        // Child already gone.
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

module.exports = { FORWARDED_SIGNALS, forwardSignals, supervise };
