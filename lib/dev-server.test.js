/**
 * Node-side tests for ENSEMBLE_DEV_PORT helpers and electron-dev argv quoting.
 * Run with: node --test lib/dev-server.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  DEFAULT_DEV_PORT,
  ELECTRON_EXTRA_ARGS_ENV,
  devServerPort,
  devServerUrl,
  localhostUrl,
  shellQuote,
  posixQuote,
  cmdQuote,
  buildNgServeArgv,
  buildNgServeCommand,
  buildElectronDevCommands,
  buildElectronDevArgv,
  buildElectronDevCommand,
  encodeElectronExtraArgs,
  decodeElectronExtraArgs,
} = require('./dev-server');

describe('devServerPort', () => {
  it('defaults to 4200 when unset', () => {
    assert.equal(devServerPort({}), DEFAULT_DEV_PORT);
    assert.equal(devServerPort({ ENSEMBLE_DEV_PORT: undefined }), 4200);
  });

  it('accepts a valid custom port', () => {
    assert.equal(devServerPort({ ENSEMBLE_DEV_PORT: '4301' }), 4301);
  });

  it('trims surrounding spaces', () => {
    assert.equal(devServerPort({ ENSEMBLE_DEV_PORT: '  4301  ' }), 4301);
  });

  it('falls back to 4200 for empty string', () => {
    assert.equal(devServerPort({ ENSEMBLE_DEV_PORT: '' }), 4200);
    assert.equal(devServerPort({ ENSEMBLE_DEV_PORT: '   ' }), 4200);
  });

  it('falls back to 4200 for non-numeric values', () => {
    assert.equal(devServerPort({ ENSEMBLE_DEV_PORT: 'abc' }), 4200);
    assert.equal(devServerPort({ ENSEMBLE_DEV_PORT: '12ab' }), 4200);
  });

  it('falls back to 4200 for 0, out-of-range, negative, and decimals', () => {
    assert.equal(devServerPort({ ENSEMBLE_DEV_PORT: '0' }), 4200);
    assert.equal(devServerPort({ ENSEMBLE_DEV_PORT: '70000' }), 4200);
    assert.equal(devServerPort({ ENSEMBLE_DEV_PORT: '-1' }), 4200);
    assert.equal(devServerPort({ ENSEMBLE_DEV_PORT: '4200.5' }), 4200);
  });
});

describe('devServerUrl', () => {
  it('builds http://localhost:<port>', () => {
    assert.equal(devServerUrl({}), 'http://localhost:4200');
    assert.equal(devServerUrl({ ENSEMBLE_DEV_PORT: '4301' }), 'http://localhost:4301');
    assert.equal(localhostUrl(4301), 'http://localhost:4301');
  });
});

describe('quoting helpers', () => {
  it('posixQuote blocks $, backticks and command substitution literals', () => {
    assert.equal(posixQuote('--user-data-dir=/tmp/$HOME x'), `'--user-data-dir=/tmp/$HOME x'`);
    assert.equal(posixQuote('--a=`id`'), "'--a=`id`'");
    assert.equal(posixQuote("it's"), `'it'\\''s'`);
  });

  it('cmdQuote keeps Windows paths with spaces and does not double backslashes', () => {
    const quoted = cmdQuote('C:\\Users\\foo bar');
    assert.equal(quoted, '"C:\\Users\\foo bar"');
    assert.ok(!quoted.includes('\\\\Users'));
    assert.ok(!quoted.includes('\\\\foo'));
  });

  it('cmdQuote neutralizes %VAR% for cmd (unit-test string only)', () => {
    assert.equal(cmdQuote('%VAR%'), '"%%VAR%%"');
    assert.equal(cmdQuote('C:\\Users\\%USERNAME%\\App Data'), '"C:\\Users\\%%USERNAME%%\\App Data"');
  });
});

describe('buildElectronDevCommand / argv', () => {
  it('keeps concurrently jobs as single argv units with matching port and url', () => {
    const env = { ENSEMBLE_DEV_PORT: '4301' };
    const runner = '/repo/scripts/run-electron.js';
    const { serveCmd, electronCmd, port, url } = buildElectronDevCommands(env, [], {
      platform: 'linux',
      runnerPath: runner,
    });
    assert.equal(port, 4301);
    assert.equal(url, 'http://localhost:4301');
    assert.equal(serveCmd, 'ng serve --port 4301');
    assert.match(electronCmd, /^wait-on http:\/\/localhost:4301 && /);
    assert.ok(electronCmd.includes(posixQuote(runner)));
    // Extras must not appear in the shell command (they go via env).
    assert.ok(!electronCmd.includes('user-data-dir'));

    const argv = buildElectronDevArgv(env, ['--x'], { platform: 'linux', runnerPath: runner });
    assert.equal(argv.length, 3);
    assert.equal(argv[0], 'concurrently');
    assert.equal(argv[1], serveCmd);
    assert.equal(argv[2], electronCmd);
    assert.match(argv[1], / /);
    assert.match(argv[2], / /);
  });

  it('forwards extra argv only via ENSEMBLE_ELECTRON_EXTRA_ARGS encoding', () => {
    const extra = ['--user-data-dir=/tmp/$HOME x', '--a=`id`'];
    const encoded = encodeElectronExtraArgs(extra);
    assert.deepEqual(decodeElectronExtraArgs({ [ELECTRON_EXTRA_ARGS_ENV]: encoded }), extra);
    const { electronCmd } = buildElectronDevCommands({}, extra, {
      platform: 'linux',
      runnerPath: '/r/run-electron.js',
    });
    assert.ok(!electronCmd.includes('$HOME'));
    assert.ok(!electronCmd.includes('`id`'));
  });

  it('Windows command string uses cmdQuote without doubled path backslashes', () => {
    const runner = 'C:\\repo\\scripts\\run-electron.js';
    const { electronCmd } = buildElectronDevCommands(
      { ENSEMBLE_DEV_PORT: '4301' },
      ['--user-data-dir=C:\\Users\\%USERNAME%\\App Data'],
      { platform: 'win32', runnerPath: runner, nodePath: 'node' }
    );
    assert.equal(electronCmd, `wait-on http://localhost:4301 && ${cmdQuote('node')} ${cmdQuote(runner)}`);
    assert.ok(electronCmd.includes('C:\\repo\\scripts\\run-electron.js'));
    assert.ok(!electronCmd.includes('\\\\repo'));
    assert.ok(!electronCmd.includes('\\\\scripts'));

    const shellCmd = buildElectronDevCommand(
      { ENSEMBLE_DEV_PORT: '4301' },
      ['--user-data-dir=C:\\Users\\%USERNAME%\\App Data'],
      { platform: 'win32', runnerPath: runner, nodePath: 'node' }
    );
    assert.match(shellCmd, /"ng serve --port 4301"/);
    // Outer wrap escapes inner quotes; path backslashes stay single.
    assert.ok(shellCmd.includes('C:\\repo\\scripts\\run-electron.js'));
    assert.ok(!shellCmd.includes('\\\\repo'));
    // Extras are not in the shell string; % would be neutralized if they were:
    assert.ok(!shellCmd.includes('%USERNAME%'));
    assert.equal(cmdQuote('C:\\Users\\%USERNAME%\\App Data'), '"C:\\Users\\%%USERNAME%%\\App Data"');
  });

  it('buildNgServeArgv keeps port as its own argv element', () => {
    const argv = buildNgServeArgv({ ENSEMBLE_DEV_PORT: '4301' }, ['--verbose']);
    assert.deepEqual(argv, ['ng', 'serve', '--port', '4301', '--verbose']);
    assert.match(buildNgServeCommand({ ENSEMBLE_DEV_PORT: '4301' }), /"4301"/);
  });
});

describe('invalid ENSEMBLE_DEV_PORT warns once', () => {
  it('buildElectronDevCommands warns a single time for one invalid env', () => {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      buildElectronDevCommands(
        { ENSEMBLE_DEV_PORT: 'nope' },
        [],
        { platform: 'linux', runnerPath: '/r/run-electron.js' }
      );
    } finally {
      console.warn = original;
    }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Invalid ENSEMBLE_DEV_PORT/);
  });

  it('electron-dev launcher warns once for invalid port', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ensemble-warn-'));
    const binDir = path.join(tmpDir, 'bin');
    await fs.mkdir(binDir);
    // Fake npx that exits immediately (do not run concurrently / ng / electron).
    await fs.writeFile(
      path.join(binDir, 'npx'),
      `#!/usr/bin/env node\nprocess.exit(0);\n`,
      { mode: 0o755 }
    );
    const script = path.join(__dirname, '..', 'scripts', 'electron-dev.js');
    const child = spawn(process.execPath, [script], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
        ENSEMBLE_DEV_PORT: 'not-a-port',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (c) => {
      err += c;
    });
    const status = await new Promise((resolve) => child.on('exit', resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
    assert.equal(status, 0);
    const matches = err.match(/Invalid ENSEMBLE_DEV_PORT/g) || [];
    assert.equal(matches.length, 1, `expected one warning, got: ${err}`);
  });
});

describe('electron-dev spawn: shell does not expand $ / backticks', () => {
  /** @type {string} */
  let tmpDir;
  /** @type {string} */
  let binDir;
  /** @type {string} */
  let npxLog;
  /** @type {string} */
  let electronLog;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ensemble-dev-spawn-'));
    binDir = path.join(tmpDir, 'bin');
    await fs.mkdir(binDir);
    npxLog = path.join(tmpDir, 'npx-argv.json');
    electronLog = path.join(tmpDir, 'electron-argv.json');

    // Fake npx: log argv; for concurrently, stub job 1 and run job 2 through sh
    // (real concurrently shell path) after dropping wait-on.
    const npxBody = `#!/usr/bin/env node
const fs = require('fs');
const { spawnSync } = require('child_process');
fs.writeFileSync(process.env.NPX_ARGV_LOG, JSON.stringify(process.argv.slice(2)));
const args = process.argv.slice(2);
if (args[0] === 'concurrently' && args.length >= 3) {
  const electronJob = args[2].replace(/^wait-on\\s+\\S+\\s+&&\\s+/, '');
  const r = spawnSync('sh', ['-c', electronJob], { stdio: 'inherit', env: process.env });
  process.exit(r.status == null ? 1 : r.status);
}
process.exit(0);
`;
    const electronBody = `#!/usr/bin/env node
const fs = require('fs');
fs.writeFileSync(process.env.ELECTRON_ARGV_LOG, JSON.stringify(process.argv.slice(2)));
process.exit(0);
`;
    await fs.writeFile(path.join(binDir, 'npx'), npxBody, { mode: 0o755 });
    await fs.writeFile(path.join(binDir, 'electron'), electronBody, { mode: 0o755 });
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('passes two concurrent job strings and delivers literal $ / backticks to electron', async () => {
    const script = path.join(__dirname, '..', 'scripts', 'electron-dev.js');
    const dollarArg = '--user-data-dir=/tmp/$HOME x';
    const tickArg = '--a=`id`';
    const child = spawn(process.execPath, [script, dollarArg, tickArg], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
        NPX_ARGV_LOG: npxLog,
        ELECTRON_ARGV_LOG: electronLog,
        ENSEMBLE_DEV_PORT: '4301',
        // Ensure expansion would change the string if the shell saw it:
        HOME: '/would-expand-home',
      },
      stdio: 'inherit',
    });
    const status = await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(status, 0);

    const npxArgv = JSON.parse(await fs.readFile(npxLog, 'utf8'));
    assert.equal(npxArgv[0], 'concurrently');
    assert.equal(npxArgv.length, 3);
    assert.equal(npxArgv[1], 'ng serve --port 4301');
    assert.match(npxArgv[2], /^wait-on http:\/\/localhost:4301 && /);
    assert.ok(npxArgv[2].includes('run-electron.js'));
    assert.ok(!npxArgv[2].includes('$HOME'));
    assert.ok(!npxArgv.includes('ng'));
    assert.ok(!npxArgv.includes('serve'));

    const electronArgv = JSON.parse(await fs.readFile(electronLog, 'utf8'));
    assert.equal(electronArgv[0], '.');
    assert.ok(electronArgv.includes(dollarArg), `got ${JSON.stringify(electronArgv)}`);
    assert.ok(electronArgv.includes(tickArg), `got ${JSON.stringify(electronArgv)}`);
    assert.ok(!electronArgv.some((a) => String(a).includes('/would-expand-home')));
    assert.ok(!electronArgv.some((a) => String(a).includes('uid=')));
  });
});
