#!/usr/bin/env node
/** Run `ng serve` on ENSEMBLE_DEV_PORT (default 4200). */
const { spawn } = require('child_process');
const path = require('path');
const { supervise } = require('../lib/forward-signals');
const { buildNgServeArgv, buildNgServeCommand } = require('../lib/dev-server');

const extra = process.argv.slice(2);
const argv = buildNgServeArgv(process.env, extra);
const cwd = path.join(__dirname, '..');
const env = process.env;

/** @type {import('child_process').ChildProcess} */
let child;
if (process.platform === 'win32') {
  child = spawn(buildNgServeCommand(process.env, extra), {
    stdio: 'inherit',
    shell: true,
    env,
    cwd,
  });
} else {
  child = spawn('npx', argv, {
    stdio: 'inherit',
    shell: false,
    env,
    cwd,
  });
}

// Forward SIGINT/SIGTERM/SIGHUP to the child and exit with its code or signal.
supervise(child);
