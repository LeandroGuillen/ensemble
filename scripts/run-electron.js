#!/usr/bin/env node
/**
 * Spawn `electron .` with args from ENSEMBLE_ELECTRON_EXTRA_ARGS (JSON array).
 * Used so concurrently's shell never parses user-forwarded argv.
 *
 * Resolves the binary via require('electron') (or ENSEMBLE_ELECTRON_BIN) and
 * spawns with shell:false so extras stay an argv array on every platform.
 */
const { spawn } = require('child_process');
const path = require('path');
const { decodeElectronExtraArgs, buildElectronSpawn } = require('../lib/dev-server');

const extras = decodeElectronExtraArgs(process.env);
const cwd = path.join(__dirname, '..');
const { command, args, shell } = buildElectronSpawn(extras, {
  env: process.env,
  platform: process.platform,
  cwd,
});

const child = spawn(command, args, {
  stdio: 'inherit',
  shell,
  env: process.env,
  cwd,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
