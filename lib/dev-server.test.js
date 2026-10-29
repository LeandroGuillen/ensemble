/**
 * Node-side tests for ENSEMBLE_DEV_PORT helpers.
 * Run with: node --test lib/dev-server.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_DEV_PORT, devServerPort, devServerUrl } = require('./dev-server');

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
