// Launch Ensemble under Xvfb against the production build and run a scenario.
//
//   xvfb-run -a node .claude/skills/run-app/scripts/launch.mjs <scenario.mjs> [--fresh]
//
// - Serves dist/browser on a random free 127.0.0.1 port (never 4200) and points
//   the window there, because an unpackaged Electron always loads localhost:4200.
// - Isolates Electron userData with XDG_CONFIG_HOME so the user's recent
//   projects and settings are never touched.
// - Seeds a sample project (3 characters, 1 location, 1 book) and opens it.
// - A scenario is an ES module: export default async ({ app, page, shot, sleep, go, pickMenu }) => {}
//
// Env: RUN_DIR (sandbox root, default /tmp/ensemble-run), OUT (screenshots,
// default $RUN_DIR/shots), WIDTH/HEIGHT (window size, default 1440x900).

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const RUN_DIR = process.env.RUN_DIR || '/tmp/ensemble-run';
const OUT = process.env.OUT || path.join(RUN_DIR, 'shots');
const CONFIG = path.join(RUN_DIR, 'config');
const PROJECT = path.join(RUN_DIR, 'project');
const DIST = path.join(APP, 'dist', 'browser');
const WIDTH = Number(process.env.WIDTH || 1440);
const HEIGHT = Number(process.env.HEIGHT || 900);

const args = process.argv.slice(2);
const fresh = args.includes('--fresh');
const scenarioArg = args.find(a => !a.startsWith('--'));
if (!scenarioArg) {
  console.error('usage: xvfb-run -a node launch.mjs <scenario.mjs> [--fresh]');
  process.exit(2);
}

let electron;
try {
  ({ _electron: electron } = createRequire(path.join(RUN_DIR, 'tools', 'x.js'))('playwright-core'));
} catch {
  console.error(`playwright-core missing. Run: npm i --prefix ${path.join(RUN_DIR, 'tools')} playwright-core`);
  process.exit(2);
}
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`No build at ${DIST}. Run: npm run build`);
  process.exit(2);
}

// ─── Sandbox ────────────────────────────────────────────────────────────────

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

const character = (id, name, category, body) => `---
id: ${id}
name: ${name}
category: ${category}
tags:
  - magic-user
books:
  - n23
created: "2024-01-15T10:30:00Z"
modified: "2024-01-20T14:45:00Z"
---

${body}
`;

function seed() {
  if (fresh) {
    fs.rmSync(PROJECT, { recursive: true, force: true });
    fs.rmSync(CONFIG, { recursive: true, force: true });
  }

  if (!fs.existsSync(path.join(PROJECT, 'ensemble.json'))) {
    write(path.join(PROJECT, 'ensemble.json'), JSON.stringify({
      projectName: 'Run Sandbox',
      version: '1.0.0',
      categories: [
        { id: 'main-character', name: 'Main Character', color: '#e5a855' },
        { id: 'supporting', name: 'Supporting', color: '#60a5fa' },
      ],
      tags: [
        { id: 'magic-user', name: 'Magic User', color: '#a78bfa' },
        { id: 'pogo', name: 'Pogo', color: '#4ade80' },
      ],
      // Books need a color or every save fails with "Book color is required"
      books: [{ id: 'n23', name: 'The Grey Witch', code: 'n23', color: '#8b5cf6' }],
      settings: {
        defaultCategory: 'main-character',
        characterStyles: [{ id: 'default', name: 'Default' }],
        defaultCharacterStyle: 'default',
      },
      pinboards: [],
      lastSession: { lastRoute: '/characters' },
    }, null, 2));
    const chars = path.join(PROJECT, 'characters');
    write(path.join(chars, 'dessir-galsea', 'dessir-galsea.md'),
      character('m0k3r5abc123', 'Dessir Galsea', 'main-character', 'A witch of the grey harbor, quiet and stubborn.'));
    write(path.join(chars, 'roger-rabbit', 'roger-rabbit.md'),
      character('m0k3r5abc124', 'Roger Rabbit', 'supporting', 'Comic relief with a surprising past.'));
    write(path.join(chars, 'mara-voss', 'mara-voss.md'),
      character('m0k3r5abc125', 'Mara Voss', 'main-character', 'Cartographer who maps places that do not exist yet.'));
    fs.mkdirSync(path.join(chars, 'casts'), { recursive: true });
    write(path.join(PROJECT, 'locations', '_grey-harbor.md'),
      '---\nid: m0k3r5loc001\nname: Grey Harbor\nbooks:\n  - n23\n---\n\nFog, ropes, gulls.\n');
  }

  // Electron's userData is $XDG_CONFIG_HOME/ensemble; this opens the sandbox project
  write(path.join(CONFIG, 'ensemble', 'recent-projects.json'),
    JSON.stringify([{ path: PROJECT, lastAccessed: new Date().toISOString() }], null, 2));
}

// ─── Static server for dist/browser ─────────────────────────────────────────

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(DIST, rel);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(DIST, 'index.html');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ─── Run ────────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch() {
  // Launch is occasionally flaky under Xvfb (timeout before the first window)
  for (let attempt = 1; ; attempt++) {
    try {
      return await electron.launch({
        executablePath: path.join(APP, 'node_modules', 'electron', 'dist', 'electron'),
        args: ['--no-sandbox', APP],
        env: { ...process.env, XDG_CONFIG_HOME: CONFIG },
        timeout: 30000,
      });
    } catch (error) {
      if (attempt >= 3) throw error;
      console.log(`launch attempt ${attempt} failed (${error.message.split('\n')[0]}), retrying`);
    }
  }
}

seed();
fs.mkdirSync(OUT, { recursive: true });
const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/`;
const scenario = (await import(pathToFileURL(path.resolve(scenarioArg)).href)).default;

const app = await launch();
let failed = false;
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => console.log('PAGE ERROR', error.message));
  await app.evaluate(({ BrowserWindow }, { url, width, height }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(width, height);
    return win.loadURL(url);
  }, { url, width: WIDTH, height: HEIGHT });
  await page.waitForLoadState('domcontentloaded');
  await sleep(2500);

  const shot = async name => {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    console.log('shot', file);
  };
  // Hash routing: go('#/characters')
  const go = async hash => {
    await page.evaluate(h => { location.hash = h; }, hash);
    await sleep(900);
  };
  // Pick a theme or skin by its visible label from the sidebar palette menu.
  // The menu button (.theme-control) is hidden on Settings, so go to the list first.
  const pickMenu = async label => {
    await go('#/characters');
    await page.click('.theme-control');
    await sleep(300);
    const found = await page.evaluate(text => {
      const item = [...document.querySelectorAll('.theme-menu-item')]
        .find(b => b.querySelector('.theme-menu-label')?.textContent.trim() === text);
      item?.click();
      return !!item;
    }, label);
    if (!found) throw new Error(`No theme/skin menu item labelled "${label}"`);
    await sleep(700);
  };

  await scenario({ app, page, shot, sleep, go, pickMenu, project: PROJECT });
} catch (error) {
  failed = true;
  console.log('ERROR', error.message);
  try {
    await (await app.firstWindow()).screenshot({ path: path.join(OUT, 'error.png') });
    console.log('shot', path.join(OUT, 'error.png'));
  } catch {}
} finally {
  await app.close();
  server.close();
}
process.exit(failed ? 1 : 0);
