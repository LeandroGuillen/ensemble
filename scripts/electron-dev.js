#!/usr/bin/env node
/**
 * Dev desktop: Angular on ENSEMBLE_DEV_PORT + Electron loading the same URL.
 * Extra argv (e.g. --user-data-dir=...) are forwarded to Electron only.
 *
 * Spawns without shell and passes each concurrently job as one argv element
 * so `ng serve` / `wait-on … && electron` are never word-split by the shell.
 */
const { spawn } = require('child_process');
const path = require('path');
const { buildElectronDevArgv, buildElectronDevCommand } = require('../lib/dev-server');

const electronExtra = process.argv.slice(2);
const argv = buildElectronDevArgv(process.env, electronExtra);
const cwd = path.join(__dirname, '..');
const env = process.env;

/** @type {import('child_process').ChildProcess} */
let child;
if (process.platform === 'win32') {
  // .cmd shims need a shell; use one pre-quoted command string.
  child = spawn(buildElectronDevCommand(process.env, electronExtra), {
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
