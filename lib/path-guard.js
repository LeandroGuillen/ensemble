const path = require('path');

/**
 * Session allowlist for file IPC: the open work folder plus folders and files the user
 * picked in a dialog or opened as a project. The renderer runs with Node integration,
 * so this catches mistakes (a path built from bad data) rather than a hostile renderer.
 */

/** @type {string|null} */
let workFolder = null;
const allowedRoots = new Set();

function setWorkFolder(folderPath) {
  if (!folderPath) {
    workFolder = null;
    allowedRoots.clear();
    return;
  }
  workFolder = path.resolve(folderPath);
  allowedRoots.add(workFolder);
}

function allowPath(targetPath) {
  if (targetPath && typeof targetPath === 'string') {
    allowedRoots.add(path.resolve(targetPath));
  }
}

function getWorkFolder() {
  return workFolder;
}

function isPathUnderRoot(resolvedPath, root) {
  const rel = path.relative(root, resolvedPath);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * @param {unknown} filePath
 * @returns {string} resolved absolute path
 * @throws {Error} if the path is not inside an allowed root
 */
function assertPathAllowed(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Path is required');
  }
  const resolved = path.resolve(filePath);
  for (const root of allowedRoots) {
    if (isPathUnderRoot(resolved, root)) return resolved;
  }
  throw new Error(allowedRoots.size
    ? 'Path is outside the work folder and allowed directories'
    : 'Work folder is not set; path is outside allowed directories');
}

module.exports = { assertPathAllowed, setWorkFolder, allowPath, getWorkFolder };
