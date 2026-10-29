#!/usr/bin/env node
/**
 * Spawn `electron .` with args from ENSEMBLE_ELECTRON_EXTRA_ARGS (JSON array).
 * Used so concurrently's shell never parses user-forwarded argv.
 */
const { spawn } = require('child_process');
const path = require('path');
const { decodeElectronExtraArgs } = require('../lib/dev-server');

const extras = decodeElectronExtraArgs(process.env);
const electronBin = process.platform === 'win32' ? 'electron.cmd' : 'electron';
const child = spawn(electronBin, ['.', ...extras], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
  cwd: path.join(__dirname, '..'),
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
