const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { assertPathInsideWorkFolder, setWorkFolder, allowPath, getWorkFolder } = require('./path-guard');

// `assertPathInsideWorkFolder` whitelists app.getPath(...) roots plus os.tmpdir().
const app = {
  getPath: (name) => path.join(os.tmpdir(), `ensemble-path-guard-${name}`),
};

describe('path-guard', () => {
  beforeEach(() => {
    // Reset module state between tests (clears work folder and extra roots).
    setWorkFolder(null);
  });

  test('allows paths inside the work folder', () => {
    setWorkFolder('/work/project');
    assert.equal(assertPathInsideWorkFolder('/work/project/characters/mara.md', { app }), path.resolve('/work/project/characters/mara.md'));
    assert.equal(assertPathInsideWorkFolder('/work/project', { app }), path.resolve('/work/project'));
  });

  test('rejects paths outside the work folder', () => {
    setWorkFolder('/work/project');
    assert.throws(() => assertPathInsideWorkFolder('/etc/passwd', { app }), /outside/i);
    assert.throws(() => assertPathInsideWorkFolder('/work/other/file.md', { app }), /outside/i);
  });

  test('rejects path traversal that escapes the work folder', () => {
    setWorkFolder('/work/project');
    assert.throws(() => assertPathInsideWorkFolder('/work/project/../../etc/passwd', { app }), /outside/i);
    assert.throws(() => assertPathInsideWorkFolder('/work/project/../secrets.md', { app }), /outside/i);
  });

  test('rejects empty and non-string paths', () => {
    setWorkFolder('/work/project');
    assert.throws(() => assertPathInsideWorkFolder('', { app }), /required/i);
    assert.throws(() => assertPathInsideWorkFolder(null, { app }), /required/i);
    assert.throws(() => assertPathInsideWorkFolder(undefined, { app }), /required/i);
    assert.throws(() => assertPathInsideWorkFolder(123, { app }), /required/i);
  });

  test('rejects every path when no work folder is set', () => {
    assert.throws(() => assertPathInsideWorkFolder('/work/project/file.md', { app }), /outside|not set/i);
  });

  test('allows an explicitly allowPath-ed root', () => {
    setWorkFolder('/work/project');
    allowPath('/backup/target');
    assert.equal(assertPathInsideWorkFolder('/backup/target/snapshot.zip', { app }), path.resolve('/backup/target/snapshot.zip'));
  });

  test('allows whitelisted system roots (temp)', () => {
    setWorkFolder('/work/project');
    const tmp = path.join(os.tmpdir(), 'ensemble-path-guard-temp');
    assert.equal(assertPathInsideWorkFolder(path.join(tmp, 'x.md'), { app }), path.resolve(path.join(tmp, 'x.md')));
  });

  test('getWorkFolder reflects setWorkFolder and clears on null', () => {
    setWorkFolder('/work/project');
    assert.equal(getWorkFolder(), path.resolve('/work/project'));
    setWorkFolder(null);
    assert.equal(getWorkFolder(), null);
  });
});
