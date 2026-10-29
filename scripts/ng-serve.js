#!/usr/bin/env node
/** Run `ng serve` on ENSEMBLE_DEV_PORT (default 4200). */
const { spawn } = require('child_process');
const path = require('path');
const { devServerPort } = require('../lib/dev-server');

const port = String(devServerPort(process.env));
const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['ng', 'serve', '--port', port, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    shell: true,
    env: process.env,
    cwd: path.join(__dirname, '..'),
  }
);
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
