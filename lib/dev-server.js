/**
 * Dev-server URL helpers for Electron + npm scripts.
 * Port comes from ENSEMBLE_DEV_PORT (default 4200).
 *
 * Electron extra argv from `npm start -- …` is passed via
 * ENSEMBLE_ELECTRON_EXTRA_ARGS (JSON array) to scripts/run-electron.js so
 * concurrently's shell never sees `$`, backticks, or `%VAR%`.
 */

const path = require('path');

const DEFAULT_DEV_PORT = 4200;
/** Env key: JSON string array of args after `electron .` */
const ELECTRON_EXTRA_ARGS_ENV = 'ENSEMBLE_ELECTRON_EXTRA_ARGS';

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
 * @param {number} port
 * @returns {string}
 */
function localhostUrl(port) {
  return `http://localhost:${port}`;
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {string}
 */
function devServerUrl(env = process.env) {
  return localhostUrl(devServerPort(env));
}

/**
 * Double-quote for POSIX outer argv embedding (npx concurrently jobs).
 * Prefer {@link posixQuote} for values that must not expand under sh.
 * @param {string} value
 * @returns {string}
 */
function shellQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * POSIX single quotes: no `$`, backtick, or `$(…)` expansion.
 * @param {string} value
 * @returns {string}
 */
function posixQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Quote a token for embedding in a Windows cmd.exe command string.
 *
 * Limitation: replacing `%` with `%%` only yields a literal `%` inside `.bat` /
 * `.cmd` scripts. On an interactive `cmd /c "…"` command line, `%VAR%` can still
 * expand — do not put user-forwarded argv on any cmd command line (pass them via
 * {@link ELECTRON_EXTRA_ARGS_ENV} / argv arrays with shell:false instead).
 *
 * Ordinary path backslashes are left alone; only backslashes before `"` are
 * doubled (CRT argv rules).
 *
 * @param {string} value
 * @returns {string}
 */
function cmdQuote(value) {
  // %% is documented above as bat-only; still applied for bat callers, not as
  // a guarantee for cmd /c.
  const s = String(value).replace(/%/g, '%%');
  let out = '"';
  let bs = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') {
      bs++;
      continue;
    }
    if (ch === '"') {
      out += '\\'.repeat(bs * 2 + 1) + '"';
      bs = 0;
      continue;
    }
    if (bs) {
      out += '\\'.repeat(bs);
      bs = 0;
    }
    out += ch;
  }
  out += '\\'.repeat(bs * 2) + '"';
  return out;
}

/** Env override for tests: absolute path to a fake electron binary. */
const ELECTRON_BIN_ENV = 'ENSEMBLE_ELECTRON_BIN';

/**
 * Resolve the Electron executable path.
 * Prefers ENSEMBLE_ELECTRON_BIN (tests), then require('electron'), else PATH name.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   platform?: string,
 *   requireElectron?: () => string,
 * }} [options]
 * @returns {{ bin: string, source: 'env' | 'require' | 'path' }}
 */
function resolveElectronBinary(options = {}) {
  const env = options.env || process.env;
  const fromEnv = env && env[ELECTRON_BIN_ENV];
  if (fromEnv && String(fromEnv).trim()) {
    return { bin: String(fromEnv).trim(), source: 'env' };
  }
  const requireElectron =
    options.requireElectron ||
    (() => {
      // eslint-disable-next-line import/no-extraneous-dependencies, global-require
      return require('electron');
    });
  try {
    const resolved = requireElectron();
    if (resolved && typeof resolved === 'string') {
      return { bin: resolved, source: 'require' };
    }
  } catch {
    // fall through to PATH
  }
  const platform = options.platform || process.platform;
  return { bin: platform === 'win32' ? 'electron.cmd' : 'electron', source: 'path' };
}

/**
 * Spawn options for `electron . <extras>` — prefer shell:false with a resolved
 * binary so user args stay an untouched argv array on every platform.
 *
 * @param {string[]} extraArgs
 * @param {{
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   platform?: string,
 *   requireElectron?: () => string,
 *   cwd?: string,
 * }} [options]
 * @returns {{ command: string, args: string[], shell: boolean, cwd?: string }}
 */
function buildElectronSpawn(extraArgs = [], options = {}) {
  const platform = options.platform || process.platform;
  const { bin, source } = resolveElectronBinary(options);
  const extras = extraArgs.map(String);
  // PATH fallback on win32 still needs a shell for .cmd shims; quote each user
  // arg so spaces survive. Prefer require/env paths (shell:false) in production.
  if (source === 'path' && platform === 'win32') {
    return {
      command: bin,
      args: ['.', ...extras.map(cmdQuote)],
      shell: true,
      cwd: options.cwd,
    };
  }
  return {
    command: bin,
    args: ['.', ...extras],
    shell: false,
    cwd: options.cwd,
  };
}

/**
 * @param {string} value
 * @param {string} [platform]
 * @returns {string}
 */
function quoteForShell(value, platform = process.platform) {
  return platform === 'win32' ? cmdQuote(value) : posixQuote(value);
}

/**
 * Absolute path to the electron runner (no shell-metacharacter args).
 * @param {string} [fromDir] Directory containing `scripts/` (repo root).
 * @returns {string}
 */
function electronRunnerPath(fromDir = path.join(__dirname, '..')) {
  return path.join(fromDir, 'scripts', 'run-electron.js');
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
 * @param {string} [platform]
 * @returns {string}
 */
function buildNgServeCommand(env = process.env, extraArgs = [], platform = process.platform) {
  const quote = platform === 'win32' ? cmdQuote : shellQuote;
  return ['npx', ...buildNgServeArgv(env, extraArgs)].map(quote).join(' ');
}

/**
 * The two command strings passed to concurrently (unquoted as argv elements).
 * Electron extras are NOT embedded here — set {@link ELECTRON_EXTRA_ARGS_ENV}.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @param {string[]} [_electronExtraArgs] Ignored in the command string (use env).
 * @param {{ platform?: string, runnerPath?: string }} [options]
 * @returns {{ serveCmd: string, electronCmd: string, port: number, url: string }}
 */
function buildElectronDevCommands(env = process.env, _electronExtraArgs = [], options = {}) {
  const platform = options.platform || process.platform;
  const port = devServerPort(env);
  const url = localhostUrl(port);
  const serveCmd = `ng serve --port ${port}`;
  const runner = options.runnerPath || electronRunnerPath();
  // Prefer PATH `node` on Windows so quoted paths stay portable; elsewhere use this runtime.
  const nodeBin = options.nodePath || (platform === 'win32' ? 'node' : process.execPath);
  const runQuoted =
    platform === 'win32'
      ? `${cmdQuote(nodeBin)} ${cmdQuote(runner)}`
      : `${posixQuote(nodeBin)} ${posixQuote(runner)}`;
  const electronCmd = `wait-on ${url} && ${runQuoted}`;
  return { serveCmd, electronCmd, port, url };
}

/**
 * Argv for `npx concurrently <serve> <electron>` — each concurrently job is
 * one argv element (safe with spawn shell:false).
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @param {string[]} [electronExtraArgs]
 * @param {{ platform?: string, runnerPath?: string }} [options]
 * @returns {string[]}
 */
function buildElectronDevArgv(env = process.env, electronExtraArgs = [], options = {}) {
  const { serveCmd, electronCmd } = buildElectronDevCommands(env, electronExtraArgs, options);
  return ['concurrently', serveCmd, electronCmd];
}

/**
 * Full shell command with both concurrently jobs quoted for shell:true (Windows).
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @param {string[]} [electronExtraArgs]
 * @param {{ platform?: string, runnerPath?: string }} [options]
 * @returns {string}
 */
function buildElectronDevCommand(env = process.env, electronExtraArgs = [], options = {}) {
  const platform = options.platform || process.platform;
  const { serveCmd, electronCmd } = buildElectronDevCommands(env, electronExtraArgs, {
    ...options,
    platform,
  });
  const quote = platform === 'win32' ? cmdQuote : shellQuote;
  return ['npx', 'concurrently', serveCmd, electronCmd].map(quote).join(' ');
}

/**
 * @param {string[]} extraArgs
 * @returns {string}
 */
function encodeElectronExtraArgs(extraArgs) {
  return JSON.stringify(extraArgs.map(String));
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
function decodeElectronExtraArgs(env = process.env) {
  const raw = env && env[ELECTRON_EXTRA_ARGS_ENV];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

module.exports = {
  DEFAULT_DEV_PORT,
  ELECTRON_EXTRA_ARGS_ENV,
  ELECTRON_BIN_ENV,
  devServerPort,
  localhostUrl,
  devServerUrl,
  shellQuote,
  posixQuote,
  cmdQuote,
  quoteForShell,
  electronRunnerPath,
  resolveElectronBinary,
  buildElectronSpawn,
  buildNgServeArgv,
  buildNgServeCommand,
  buildElectronDevCommands,
  buildElectronDevArgv,
  buildElectronDevCommand,
  encodeElectronExtraArgs,
  decodeElectronExtraArgs,
};
