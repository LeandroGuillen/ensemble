const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { assertPathAllowed, setWorkFolder, allowPath, getWorkFolder } = require('./path-guard');

describe('path-guard', () => {
  beforeEach(() => {
    // Reset module state between tests (clears work folder and extra roots).
    setWorkFolder(null);
  });

  test('allows paths inside the work folder', () => {
    setWorkFolder('/work/project');
    assert.equal(assertPathAllowed('/work/project/characters/mara.md'), path.resolve('/work/project/characters/mara.md'));
    assert.equal(assertPathAllowed('/work/project'), path.resolve('/work/project'));
  });

  test('rejects paths outside the work folder', () => {
    setWorkFolder('/work/project');
    assert.throws(() => assertPathAllowed('/etc/passwd'), /outside/i);
    assert.throws(() => assertPathAllowed('/work/other/file.md'), /outside/i);
  });

  test('rejects path traversal that escapes the work folder', () => {
    setWorkFolder('/work/project');
    assert.throws(() => assertPathAllowed('/work/project/../../etc/passwd'), /outside/i);
    assert.throws(() => assertPathAllowed('/work/project/../secrets.md'), /outside/i);
  });

  test('rejects empty and non-string paths', () => {
    setWorkFolder('/work/project');
    assert.throws(() => assertPathAllowed(''), /required/i);
    assert.throws(() => assertPathAllowed(null), /required/i);
    assert.throws(() => assertPathAllowed(undefined), /required/i);
    assert.throws(() => assertPathAllowed(123), /required/i);
  });

  test('rejects every path when no work folder is set', () => {
    assert.throws(() => assertPathAllowed('/work/project/file.md'), /outside|not set/i);
  });

  test('allows an explicitly allowPath-ed root', () => {
    setWorkFolder('/work/project');
    allowPath('/backup/target');
    assert.equal(assertPathAllowed('/backup/target/snapshot.zip'), path.resolve('/backup/target/snapshot.zip'));
  });

  test('allows names that start with dots, but not system folders outside the session', () => {
    setWorkFolder('/work/project');
    assert.equal(assertPathAllowed('/work/project/..notes.md'), path.resolve('/work/project/..notes.md'));
    assert.throws(() => assertPathAllowed(path.join(os.tmpdir(), 'x.md')), /outside/i);
  });

  test('getWorkFolder reflects setWorkFolder and clears on null', () => {
    setWorkFolder('/work/project');
    assert.equal(getWorkFolder(), path.resolve('/work/project'));
    setWorkFolder(null);
    assert.equal(getWorkFolder(), null);
  });
});
