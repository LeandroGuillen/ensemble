#!/usr/bin/env node
/** Run `ng serve` on ENSEMBLE_DEV_PORT (default 4200). */
const { spawn } = require('child_process');
const path = require('path');
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

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
