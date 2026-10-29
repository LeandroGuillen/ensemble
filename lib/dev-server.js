/**
 * Dev-server URL helpers for Electron + npm scripts.
 * Port comes from ENSEMBLE_DEV_PORT (default 4200).
 */

const DEFAULT_DEV_PORT = 4200;

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {number}
 */
function devServerPort(env = process.env) {
  const raw = env && env.ENSEMBLE_DEV_PORT;
  if (raw === undefined || raw === null) {
    return DEFAULT_DEV_PORT;
  }
  const trimmed = String(raw).trim();
  if (trimmed === '') {
    return DEFAULT_DEV_PORT;
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.warn(
      `Invalid ENSEMBLE_DEV_PORT=${JSON.stringify(String(raw))}; falling back to ${DEFAULT_DEV_PORT}`
    );
    return DEFAULT_DEV_PORT;
  }
  return n;
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {string}
 */
function devServerUrl(env = process.env) {
  return `http://localhost:${devServerPort(env)}`;
}

module.exports = { DEFAULT_DEV_PORT, devServerPort, devServerUrl };
