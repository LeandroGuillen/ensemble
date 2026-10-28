/**
 * Node-side tests for window close/quit/reload prepare-to-leave guards.
 * Run with: node --test lib/window-lifecycle.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  createLifecycleController,
  requestPrepareToLeave,
} = require('./window-lifecycle');

const IPC = {
  prepareToLeaveRequest: 'prepare-to-leave-request',
  prepareToLeaveReply: 'prepare-to-leave-reply',
};

function createFakeIpcMain() {
  const bus = new EventEmitter();
  return {
    on(channel, fn) {
      bus.on(channel, fn);
    },
    removeListener(channel, fn) {
      bus.removeListener(channel, fn);
    },
    emit(channel, ...args) {
      bus.emit(channel, ...args);
    },
  };
}

function createFakeWindow() {
  const windowBus = new EventEmitter();
  const contentsBus = new EventEmitter();
  const sent = [];
  const webContents = {
    isDestroyed: () => false,
    send(channel, ...args) {
      sent.push({ channel, args });
      contentsBus.emit('send', channel, ...args);
    },
    reload() {
      webContents.reloadCount = (webContents.reloadCount || 0) + 1;
    },
    reloadCount: 0,
  };
  const win = {
    isDestroyed: () => false,
    webContents,
    closeCount: 0,
    on(event, fn) {
      windowBus.on(event, fn);
    },
    emit(event, ...args) {
      return windowBus.emit(event, ...args);
    },
    close() {
      win.closeCount += 1;
      const event = {
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      win.emit('close', event);
      if (!event.defaultPrevented) {
        win._closed = true;
      }
    },
    _closed: false,
    _sent: sent,
  };
  return win;
}

function createFakeApp() {
  let quitCount = 0;
  return {
    quit() {
      quitCount += 1;
      this.quitCount = quitCount;
    },
    quitCount: 0,
  };
}

describe('requestPrepareToLeave', () => {
  it('allows leave when there is no window', async () => {
    const ipcMain = createFakeIpcMain();
    assert.equal(
      await requestPrepareToLeave({ win: null, ipcMain, IPC, unresponsiveMs: 20 }),
      true
    );
  });

  it('fail-opens when the renderer never acks (unresponsive)', async () => {
    const ipcMain = createFakeIpcMain();
    const win = createFakeWindow();
    const allowed = await requestPrepareToLeave({
      win,
      ipcMain,
      IPC,
      unresponsiveMs: 30,
    });
    assert.equal(allowed, true);
    assert.equal(win._sent[0]?.channel, IPC.prepareToLeaveRequest);
  });

  it('waits for result after ack and respects denial', async () => {
    const ipcMain = createFakeIpcMain();
    const win = createFakeWindow();
    const promise = requestPrepareToLeave({
      win,
      ipcMain,
      IPC,
      unresponsiveMs: 5000,
    });

    // Simulate renderer ack then cancel.
    await new Promise((r) => setTimeout(r, 5));
    ipcMain.emit(IPC.prepareToLeaveReply, { sender: win.webContents }, { type: 'ack' });
    await new Promise((r) => setTimeout(r, 5));
    ipcMain.emit(
      IPC.prepareToLeaveReply,
      { sender: win.webContents },
      { type: 'result', allowed: false }
    );

    assert.equal(await promise, false);
  });

  it('allows leave when renderer replies allowed after ack', async () => {
    const ipcMain = createFakeIpcMain();
    const win = createFakeWindow();
    const promise = requestPrepareToLeave({
      win,
      ipcMain,
      IPC,
      unresponsiveMs: 5000,
    });

    await new Promise((r) => setTimeout(r, 5));
    ipcMain.emit(IPC.prepareToLeaveReply, { sender: win.webContents }, { type: 'ack' });
    ipcMain.emit(
      IPC.prepareToLeaveReply,
      { sender: win.webContents },
      { type: 'result', allowed: true }
    );

    assert.equal(await promise, true);
  });
});

describe('createLifecycleController close/quit/reload', () => {
  let ipcMain;
  let app;
  let win;
  let lifecycle;
  let mainWindow;

  beforeEach(() => {
    ipcMain = createFakeIpcMain();
    app = createFakeApp();
    win = createFakeWindow();
    mainWindow = win;
    lifecycle = createLifecycleController({
      app,
      ipcMain,
      IPC,
      getMainWindow: () => mainWindow,
      Menu: null,
    });
    lifecycle.attachWindow(win);
  });

  function replyAllowed() {
    ipcMain.emit(IPC.prepareToLeaveReply, { sender: win.webContents }, { type: 'ack' });
    ipcMain.emit(
      IPC.prepareToLeaveReply,
      { sender: win.webContents },
      { type: 'result', allowed: true }
    );
  }

  function replyDenied() {
    ipcMain.emit(IPC.prepareToLeaveReply, { sender: win.webContents }, { type: 'ack' });
    ipcMain.emit(
      IPC.prepareToLeaveReply,
      { sender: win.webContents },
      { type: 'result', allowed: false }
    );
  }

  it('prevents close until prepareToLeave allows, then closes for real once', async () => {
    const first = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    win.emit('close', first);
    assert.equal(first.defaultPrevented, true);
    assert.equal(lifecycle.isCloseAllowed(), false);

    replyAllowed();
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(lifecycle.isCloseAllowed(), true);
    // Second close from the controller should not re-enter the guard.
    assert.ok(win.closeCount >= 1);
  });

  it('keeps the window open when prepareToLeave denies (conflict Cancel)', async () => {
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    win.emit('close', event);
    replyDenied();
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(lifecycle.isCloseAllowed(), false);
    assert.equal(lifecycle.isQuitRequested(), false);
    assert.equal(win._closed, false);
  });

  it('before-quit is deferred until close is allowed, then proceeds', async () => {
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    const proceed = lifecycle.handleBeforeQuit(event);
    assert.equal(proceed, false);
    assert.equal(event.defaultPrevented, true);
    assert.equal(lifecycle.isQuitRequested(), true);

    replyAllowed();
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(lifecycle.isCloseAllowed(), true);
    assert.ok(app.quitCount >= 1);

    const second = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    assert.equal(lifecycle.handleBeforeQuit(second), true);
    assert.equal(second.defaultPrevented, false);
  });

  it('reload waits for prepareToLeave and reloads only when allowed', async () => {
    const denied = lifecycle.reloadIfAllowed(win);
    replyDenied();
    assert.equal(await denied, false);
    assert.equal(win.webContents.reloadCount, 0);

    const allowed = lifecycle.reloadIfAllowed(win);
    replyAllowed();
    assert.equal(await allowed, true);
    assert.equal(win.webContents.reloadCount, 1);
  });

  it('does not loop when close is already allowed', () => {
    lifecycle._resetForTests({ allowClose: true });
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    win.emit('close', event);
    assert.equal(event.defaultPrevented, false);
  });
});
