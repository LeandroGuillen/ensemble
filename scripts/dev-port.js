#!/usr/bin/env node
/** Print ENSEMBLE_DEV_PORT (default 4200) for npm scripts. */
const { devServerPort } = require('../lib/dev-server');
process.stdout.write(`${devServerPort(process.env)}\n`);
