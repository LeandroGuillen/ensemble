/**
 * Dev-server URL helpers for Electron + npm scripts.
 * Port comes from ENSEMBLE_DEV_PORT (default 4200).
 */

const DEFAULT_DEV_PORT = 4200;

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {number}
 */
function devServerPort(env = process.env) {
  const raw = env && env.ENSEMBLE_DEV_PORT;
  if (raw === undefined || raw === null) {
    return DEFAULT_DEV_PORT;
  }
  const trimmed = String(raw).trim();
  if (trimmed === '') {
    return DEFAULT_DEV_PORT;
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.warn(
      `Invalid ENSEMBLE_DEV_PORT=${JSON.stringify(String(raw))}; falling back to ${DEFAULT_DEV_PORT}`
    );
    return DEFAULT_DEV_PORT;
  }
  return n;
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {string}
 */
function devServerUrl(env = process.env) {
  return `http://localhost:${devServerPort(env)}`;
}

/**
 * Double-quote for POSIX sh and Windows cmd when spawn uses shell:true.
 * @param {string} value
 * @returns {string}
 */
function shellQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Quote a token only when the shell would otherwise split it.
 * @param {string} value
 * @returns {string}
 */
function shellQuoteIfNeeded(value) {
  const s = String(value);
  if (s === '&&' || s === '||' || s === '|') return s;
  if (!/[\s"'$`\\]/.test(s)) return s;
  return shellQuote(s);
}

/**
 * Argv for `npx ng serve …` (each element is one argv unit; no shell join).
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @param {string[]} [extraArgs]
 * @returns {string[]}
 */
function buildNgServeArgv(env = process.env, extraArgs = []) {
  return ['ng', 'serve', '--port', String(devServerPort(env)), ...extraArgs.map(String)];
}

/**
 * Shell command to run ng serve on ENSEMBLE_DEV_PORT.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @param {string[]} [extraArgs]
 * @returns {string}
 */
function buildNgServeCommand(env = process.env, extraArgs = []) {
  return ['npx', ...buildNgServeArgv(env, extraArgs)].map(shellQuote).join(' ');
}

/**
 * The two command strings passed to concurrently (unquoted).
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @param {string[]} [electronExtraArgs] Forwarded only to `electron`.
 * @returns {{ serveCmd: string, electronCmd: string, port: number, url: string }}
 */
function buildElectronDevCommands(env = process.env, electronExtraArgs = []) {
  const port = devServerPort(env);
  const url = devServerUrl(env);
  const serveCmd = `ng serve --port ${port}`;
  const electronCmd = ['wait-on', url, '&&', 'electron', '.', ...electronExtraArgs.map(String)]
    .map(shellQuoteIfNeeded)
    .join(' ');
  return { serveCmd, electronCmd, port, url };
}

/**
 * Argv for `npx concurrently <serve> <electron>` — each concurrently job is
 * one argv element (safe with spawn shell:false).
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @param {string[]} [electronExtraArgs]
 * @returns {string[]}
 */
function buildElectronDevArgv(env = process.env, electronExtraArgs = []) {
  const { serveCmd, electronCmd } = buildElectronDevCommands(env, electronExtraArgs);
  return ['concurrently', serveCmd, electronCmd];
}

/**
 * Full shell command with both concurrently jobs double-quoted so shell:true
 * cannot split `ng serve` / `wait-on … && electron` into separate words.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @param {string[]} [electronExtraArgs]
 * @returns {string}
 */
function buildElectronDevCommand(env = process.env, electronExtraArgs = []) {
  const { serveCmd, electronCmd } = buildElectronDevCommands(env, electronExtraArgs);
  return ['npx', 'concurrently', serveCmd, electronCmd].map(shellQuote).join(' ');
}

module.exports = {
  DEFAULT_DEV_PORT,
  devServerPort,
  devServerUrl,
  shellQuote,
  shellQuoteIfNeeded,
  buildNgServeArgv,
  buildNgServeCommand,
  buildElectronDevCommands,
  buildElectronDevArgv,
  buildElectronDevCommand,
};
