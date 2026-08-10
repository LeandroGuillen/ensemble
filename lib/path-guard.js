const path = require('path');
const os = require('os');

/** @type {string|null} */
let workFolder = null;

/** Extra roots allowed for the session (dialog picks, duplicate dest, etc.). */
const extraRoots = new Set();

function setWorkFolder(folderPath) {
  if (!folderPath) {
    workFolder = null;
    extraRoots.clear();
    return;
  }
  workFolder = path.resolve(folderPath);
  extraRoots.add(workFolder);
}

function allowPath(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    return;
  }
  extraRoots.add(path.resolve(targetPath));
}

function getWorkFolder() {
  return workFolder;
}

function normalizeRoot(rootPath) {
  return path.resolve(rootPath).replace(/[\\/]+$/, '') || path.sep;
}

function isPathUnderRoot(resolvedPath, rootPath) {
  const root = normalizeRoot(rootPath);
  const resolved = path.resolve(resolvedPath);
  if (resolved === root) {
    return true;
  }
  const rel = path.relative(root, resolved);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function getWhitelistRoots(app) {
  return [
    app.getPath('userData'),
    app.getPath('temp'),
    app.getPath('downloads'),
    app.getPath('cache'),
    os.tmpdir(),
  ];
}

function getSessionRoots() {
  const roots = [];
  if (workFolder) {
    roots.push(workFolder);
  }
  for (const root of extraRoots) {
    roots.push(root);
  }
  return roots;
}

/**
 * @param {string} filePath
 * @param {{ app: import('electron').App }} options
 * @returns {string} resolved absolute path
 * @throws {Error} if path is not allowed
 */
function assertPathInsideWorkFolder(filePath, { app }) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Path is required');
  }

  const resolved = path.resolve(filePath);

  for (const root of getSessionRoots()) {
    if (isPathUnderRoot(resolved, root)) {
      return resolved;
    }
  }

  for (const root of getWhitelistRoots(app)) {
    if (isPathUnderRoot(resolved, root)) {
      return resolved;
    }
  }

  if (!workFolder && extraRoots.size === 0) {
    throw new Error('Work folder is not set; path is outside allowed directories');
  }

  throw new Error('Path is outside the work folder and allowed directories');
}

/**
 * @param {string} filePath
 * @param {import('electron').App} app
 * @returns {string} resolved absolute path
 */
function guard(filePath, app) {
  return assertPathInsideWorkFolder(filePath, { app });
}

module.exports = {
  assertPathInsideWorkFolder,
  setWorkFolder,
  allowPath,
  getWorkFolder,
  guard,
};
