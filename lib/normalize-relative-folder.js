/**
 * Strip leading/trailing/duplicate slashes and fall back to `fallback` when the
 * input is empty. Mirrors `normalizeRelativeFolder` in
 * `src/app/core/constants/project.constants.ts`; keep both implementations in
 * sync because main.js cannot import the TS bundle at runtime.
 */
function normalizeRelativeFolder(folder, fallback) {
  const trimmed = (folder || '').trim();
  const normalized = trimmed.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  return normalized || fallback;
}

module.exports = { normalizeRelativeFolder };
