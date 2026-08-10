/**
 * Standard IPC return shape. Every `ipcMain.handle` resolves to
 * one of these two forms (never rejects).
 *
 *   ok()                       -> { success: true }
 *   ok({ content, ... })       -> { success: true, content, ... }
 *   err('boom')                -> { success: false, error: 'boom' }
 *
 * Renderer code should check `result.success` first, then access extra fields.
 */
function ok(extra) {
  return extra ? { success: true, ...extra } : { success: true };
}

function err(message) {
  return { success: false, error: typeof message === 'string' ? message : String(message) };
}

module.exports = { ok, err };
