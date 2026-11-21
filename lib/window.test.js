const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { lockToApp } = require('./window');

function setup(currentUrl) {
  const webContents = new EventEmitter();
  webContents.getURL = () => currentUrl;
  webContents.setWindowOpenHandler = (handler) => { webContents.openHandler = handler; };
  const opened = [];
  lockToApp(webContents, { openExternal: async (url) => { opened.push(url); } });
  const navigate = (url) => {
    let prevented = false;
    webContents.emit('will-navigate', { preventDefault: () => { prevented = true; } }, url);
    return prevented;
  };
  return { webContents, opened, navigate };
}

test('in-app hash routes navigate; other documents are blocked', () => {
  const { navigate, opened } = setup('file:///app/dist/browser/index.html#/characters');
  assert.equal(navigate('file:///app/dist/browser/index.html#/timeline'), false);
  assert.equal(navigate('file:///home/user/dropped.html'), true);
  assert.equal(navigate('https://example.com/'), true);
  assert.deepEqual(opened, ['https://example.com/']);
});

test('window.open is denied and only web/mail links reach the system', () => {
  const { webContents, opened } = setup('http://localhost:4200/#/');
  for (const url of ['https://example.com/a', 'mailto:a@b.c', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url']) {
    assert.deepEqual(webContents.openHandler({ url }), { action: 'deny' });
  }
  assert.deepEqual(opened, ['https://example.com/a', 'mailto:a@b.c']);
});
