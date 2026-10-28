/**
 * Electron window close / quit / reload guards.
 *
 * Bare `beforeunload` + `preventDefault` silently cancels close/quit/reload in
 * Electron with no dialog. Instead, main intercepts those actions, asks the
 * renderer (via IPC) to run BookPlanService.prepareToLeave(), then proceeds or
 * stays put based on the reply.
 *
 * Fail-open: if the renderer never acks (unresponsive / no listener), the
 * action is allowed after a short timeout so quit still works.
 */

/**
 * Ask the renderer to prepare to leave. Resolves true when leave is allowed.
 *
 * @param {object} deps
 * @param {import('electron').BrowserWindow|null|undefined} deps.win
 * @param {import('electron').IpcMain} deps.ipcMain
 * @param {{ prepareToLeaveRequest: string, prepareToLeaveReply: string }} deps.IPC
 * @param {number} [deps.unresponsiveMs]
 * @returns {Promise<boolean>}
 */
function requestPrepareToLeave(deps) {
  const { win, ipcMain, IPC, unresponsiveMs = 2000 } = deps;

  if (!win || win.isDestroyed()) {
    return Promise.resolve(true);
  }
  const wc = win.webContents;
  if (!wc || wc.isDestroyed()) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;
    let acked = false;

    const failOpenTimer = setTimeout(() => {
      if (!settled && !acked) {
        settled = true;
        cleanup();
        resolve(true);
      }
    }, unresponsiveMs);

    function onReply(event, message) {
      if (event.sender !== wc) {
        return;
      }
      if (message && message.type === 'ack') {
        acked = true;
        clearTimeout(failOpenTimer);
        return;
      }
      const allowed =
        message && typeof message === 'object' && message.type === 'result'
          ? Boolean(message.allowed)
          : Boolean(message);
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(allowed);
    }

    function cleanup() {
      clearTimeout(failOpenTimer);
      ipcMain.removeListener(IPC.prepareToLeaveReply, onReply);
    }

    ipcMain.on(IPC.prepareToLeaveReply, onReply);
    try {
      wc.send(IPC.prepareToLeaveRequest);
    } catch {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(true);
      }
    }
  });
}

/**
 * Create a lifecycle controller for one app session.
 *
 * @param {object} deps
 * @param {typeof import('electron').app} deps.app
 * @param {import('electron').IpcMain} deps.ipcMain
 * @param {{ prepareToLeaveRequest: string, prepareToLeaveReply: string }} deps.IPC
 * @param {() => import('electron').BrowserWindow|null} deps.getMainWindow
 * @param {typeof import('electron').Menu} [deps.Menu]
 */
function createLifecycleController(deps) {
  const { app, ipcMain, IPC, getMainWindow, Menu } = deps;

  let allowClose = false;
  let quitRequested = false;
  /** @type {Promise<boolean>|null} */
  let inFlight = null;

  function runExclusive(win, onAllowed) {
    if (inFlight) {
      return inFlight;
    }
    inFlight = requestPrepareToLeave({ win, ipcMain, IPC })
      .then(async (allowed) => {
        if (allowed) {
          await onAllowed();
        } else {
          quitRequested = false;
        }
        return allowed;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  async function reloadIfAllowed(win) {
    if (!win || win.isDestroyed()) {
      return false;
    }
    if (inFlight) {
      return inFlight;
    }
    return runExclusive(win, () => {
      if (!win.isDestroyed()) {
        win.webContents.reload();
      }
    });
  }

  function installApplicationMenu(win) {
    if (!Menu) {
      return;
    }
    const isMac = process.platform === 'darwin';
    const template = [
      ...(isMac ? [{ role: 'appMenu' }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          {
            label: 'Reload',
            accelerator: 'CmdOrCtrl+R',
            click: () => {
              void reloadIfAllowed(win);
            },
          },
          {
            label: 'Force Reload',
            accelerator: 'CmdOrCtrl+Shift+R',
            click: () => {
              void reloadIfAllowed(win);
            },
          },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  function attachWindow(win) {
    win.on('close', (event) => {
      if (allowClose) {
        return;
      }
      event.preventDefault();
      void runExclusive(win, () => {
        allowClose = true;
        if (!win.isDestroyed()) {
          win.close();
        }
        if (quitRequested) {
          app.quit();
        }
      });
    });

    installApplicationMenu(win);
  }

  /**
   * Wire `before-quit`. Must preventDefault until prepareToLeave has allowed
   * the window to close, so quit-side cleanup does not run on Cancel.
   *
   * Returns true when the quit should proceed (caller runs cleanup).
   * Returns false when quit was deferred / cancelled via preventDefault.
   */
  function handleBeforeQuit(event) {
    if (allowClose) {
      quitRequested = true;
      return true;
    }

    event.preventDefault();
    quitRequested = true;

    const win = getMainWindow();
    if (!win || win.isDestroyed()) {
      allowClose = true;
      app.quit();
      return false;
    }

    // Drive the close handler so prepareToLeave runs once, then re-issues quit.
    win.close();
    return false;
  }

  function isCloseAllowed() {
    return allowClose;
  }

  function isQuitRequested() {
    return quitRequested;
  }

  /** Test helper: reset flags between cases. */
  function _resetForTests(options = {}) {
    allowClose = Boolean(options.allowClose);
    quitRequested = Boolean(options.quitRequested);
    inFlight = null;
  }

  return {
    attachWindow,
    handleBeforeQuit,
    reloadIfAllowed,
    requestPrepareToLeave: (win, options) =>
      requestPrepareToLeave({ win, ipcMain, IPC, ...options }),
    isCloseAllowed,
    isQuitRequested,
    _resetForTests,
  };
}

module.exports = {
  createLifecycleController,
  requestPrepareToLeave,
};
