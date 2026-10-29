#!/usr/bin/env node
/**
 * Dev desktop: Angular on ENSEMBLE_DEV_PORT + Electron loading the same URL.
 * Extra argv (e.g. --user-data-dir=...) are forwarded to Electron only via
 * ENSEMBLE_ELECTRON_EXTRA_ARGS (JSON), never through concurrently's shell.
 */
const { spawn } = require('child_process');
const path = require('path');
const {
  buildElectronDevArgv,
  buildElectronDevCommand,
  encodeElectronExtraArgs,
  ELECTRON_EXTRA_ARGS_ENV,
} = require('../lib/dev-server');

const electronExtra = process.argv.slice(2);
const cwd = path.join(__dirname, '..');
const env = {
  ...process.env,
  [ELECTRON_EXTRA_ARGS_ENV]: encodeElectronExtraArgs(electronExtra),
};
const argv = buildElectronDevArgv(env, electronExtra, { runnerPath: path.join(cwd, 'scripts', 'run-electron.js') });

/** @type {import('child_process').ChildProcess} */
let child;
if (process.platform === 'win32') {
  child = spawn(
    buildElectronDevCommand(env, electronExtra, {
      platform: 'win32',
      runnerPath: path.join(cwd, 'scripts', 'run-electron.js'),
    }),
    {
      stdio: 'inherit',
      shell: true,
      env,
      cwd,
    }
  );
} else {
  child = spawn('npx', argv, {
    stdio: 'inherit',
    shell: false,
    env,
    cwd,
  });
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
