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
  devServerPort,
  devServerUrl,
  shellQuote,
  buildNgServeArgv,
  buildNgServeCommand,
  buildElectronDevCommands,
  buildElectronDevArgv,
  buildElectronDevCommand,
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
  });
});

describe('buildElectronDevCommand / argv', () => {
  it('keeps concurrently jobs as single argv units with matching port and url', () => {
    const env = { ENSEMBLE_DEV_PORT: '4301' };
    const { serveCmd, electronCmd, port, url } = buildElectronDevCommands(env, []);
    assert.equal(port, 4301);
    assert.equal(url, 'http://localhost:4301');
    assert.equal(serveCmd, 'ng serve --port 4301');
    assert.match(electronCmd, /^wait-on http:\/\/localhost:4301 && electron \./);

    const argv = buildElectronDevArgv(env, []);
    assert.equal(argv.length, 3);
    assert.equal(argv[0], 'concurrently');
    assert.equal(argv[1], serveCmd);
    assert.equal(argv[2], electronCmd);
    // Spaces stay inside one element — the bug was shell-splitting these.
    assert.match(argv[1], / /);
    assert.match(argv[2], / /);

    const shellCmd = buildElectronDevCommand(env, []);
    assert.equal(
      shellCmd,
      ['npx', 'concurrently', serveCmd, electronCmd].map(shellQuote).join(' ')
    );
    assert.match(shellCmd, /"ng serve --port 4301"/);
    assert.match(shellCmd, /"wait-on http:\/\/localhost:4301 && electron \."/);
  });

  it('forwards extra argv with spaces only to the electron command', () => {
    const extra = ['--user-data-dir=/tmp/my dir', '--inspect'];
    const { serveCmd, electronCmd } = buildElectronDevCommands({}, extra);
    assert.equal(serveCmd, 'ng serve --port 4200');
    assert.ok(!serveCmd.includes('user-data-dir'));
    assert.match(electronCmd, /electron \. "--user-data-dir=\/tmp\/my dir" --inspect$/);
    assert.ok(!electronCmd.includes('ng serve'));

    const argv = buildElectronDevArgv({}, extra);
    assert.equal(argv[1], serveCmd);
    assert.equal(argv[2], electronCmd);
    assert.ok(argv[2].includes('--user-data-dir=/tmp/my dir'));
  });

  it('buildNgServeArgv keeps port as its own argv element', () => {
    const argv = buildNgServeArgv({ ENSEMBLE_DEV_PORT: '4301' }, ['--verbose']);
    assert.deepEqual(argv, ['ng', 'serve', '--port', '4301', '--verbose']);
    assert.match(buildNgServeCommand({ ENSEMBLE_DEV_PORT: '4301' }), /"4301"/);
  });
});

describe('electron-dev spawn with fake npx and electron on PATH', () => {
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

    // Fake npx: log argv, and if asked for concurrently, run job 2 via sh
    // after replacing wait-on with a no-op so we reach fake electron.
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

  it('passes two concurrent job strings to npx and forwards extras to electron', async () => {
    const script = path.join(__dirname, '..', 'scripts', 'electron-dev.js');
    const userData = path.join(tmpDir, 'user data');
    const child = spawn(
      process.execPath,
      [script, `--user-data-dir=${userData}`, '--inspect'],
      {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
          NPX_ARGV_LOG: npxLog,
          ELECTRON_ARGV_LOG: electronLog,
          ENSEMBLE_DEV_PORT: '4301',
        },
        stdio: 'inherit',
      }
    );
    const status = await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(status, 0);

    const npxArgv = JSON.parse(await fs.readFile(npxLog, 'utf8'));
    assert.equal(npxArgv[0], 'concurrently');
    assert.equal(npxArgv.length, 3);
    assert.equal(npxArgv[1], 'ng serve --port 4301');
    assert.match(npxArgv[2], /^wait-on http:\/\/localhost:4301 && electron \./);
    assert.ok(npxArgv[2].includes(`--user-data-dir=${userData}`));
    // Must NOT be the broken 7-word split (ng, serve, --port, …).
    assert.ok(!npxArgv.includes('ng'));
    assert.ok(!npxArgv.includes('serve'));
    assert.ok(!npxArgv.includes('--port'));

    const electronArgv = JSON.parse(await fs.readFile(electronLog, 'utf8'));
    assert.equal(electronArgv[0], '.');
    assert.ok(electronArgv.includes(`--user-data-dir=${userData}`));
    assert.ok(electronArgv.includes('--inspect'));
    assert.ok(!electronArgv.some((a) => String(a).includes('ng serve')));
  });
});
