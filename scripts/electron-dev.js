#!/usr/bin/env node
/**
 * Dev desktop: Angular on ENSEMBLE_DEV_PORT + Electron loading the same URL.
 * Extra argv (e.g. --user-data-dir=...) are forwarded to Electron only.
 */
const { spawn } = require('child_process');
const path = require('path');
const { devServerPort, devServerUrl } = require('../lib/dev-server');

const port = String(devServerPort(process.env));
const url = devServerUrl(process.env);
const electronExtra = process.argv.slice(2);

function shellQuote(s) {
  const str = String(s);
  if (!/[\s"'$`\\]/.test(str)) return str;
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const serveCmd = `ng serve --port ${port}`;
const electronCmd = ['wait-on', url, '&&', 'electron', '.', ...electronExtra]
  .map(shellQuote)
  .join(' ');

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['concurrently', serveCmd, electronCmd],
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
