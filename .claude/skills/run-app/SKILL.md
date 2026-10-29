---
name: run-app
description: Launch the Ensemble Electron app headlessly (Xvfb + Playwright) against the production build, drive it with a scenario script, and take screenshots. Use when asked to open, run, screenshot, or visually test the app, or to confirm a UI change (skins, themes, dialogs, screens) works in the real app. Never touches port 4200 or the user's real projects.
---

# Run and visually test Ensemble

CLAUDE.md says not to bring the app up for routine checks (`npm start` would fight
an already-running dev server — default port 4200, or whatever `ENSEMBLE_DEV_PORT`
is set to). Use this skill only when the user asks to open/run/visually test the
app. It is safe alongside a running dev session:

- Serves `dist/browser` on a **random free port** and loads it with
  `BrowserWindow.loadURL` (unpackaged Electron otherwise loads
  `http://localhost:${ENSEMBLE_DEV_PORT||4200}`, see `lib/window.js` /
  `lib/dev-server.js`).
- Sets `XDG_CONFIG_HOME` to a sandbox, so Electron `userData`
  (`recent-projects.json`, settings) is separate from the user's.
- Seeds and opens a sample project with 3 characters, 1 location and 1 book.

## Steps

1. Build: `npm run build` (the launcher refuses to run without `dist/browser`).
2. One-time harness deps (kept outside the repo):
   `npm i --prefix /tmp/ensemble-run/tools playwright-core`
3. Run a scenario under a virtual display:

   ```bash
   xvfb-run -a node .claude/skills/run-app/scripts/launch.mjs .claude/skills/run-app/scripts/examples/smoke.mjs
   ```

   Add `--fresh` to reset the sample project and config. Screenshots go to
   `/tmp/ensemble-run/shots/` (override with `OUT=`); `RUN_DIR`, `WIDTH` and
   `HEIGHT` are also honored.
4. Look at the PNGs with the Read tool. To compare many shots, build a contact
   sheet with ImageMagick (run it under `bash -c`; the user's shell is fish/zsh
   and won't word-split a `$imgs` list):

   ```bash
   bash -c 'cd /tmp/ensemble-run/shots && montage *-1-list.png -tile 4x -geometry 480x300+4+4 /tmp/ensemble-run/sheet.png'
   ```

## Writing a scenario

A scenario is an ES module whose default export receives:

| name | what it is |
|---|---|
| `page` | Playwright `Page` of the main window |
| `app` | Playwright `ElectronApplication` (use `app.evaluate` for main-process code) |
| `shot(name)` | screenshot to `$OUT/<name>.png` |
| `go(hash)` | navigate with hash routing, e.g. `go('#/character/m0k3r5abc123')` |
| `pickMenu(label)` | choose a theme or skin by its label in the sidebar palette menu |
| `sleep(ms)`, `project` | delay helper; sandbox project path (read `ensemble.json` to check persistence) |

Examples in `scripts/examples/`:
- `smoke.mjs`: opens the main screens.
- `skin-tour.mjs`: switches every skin via the menu, checks `html[data-skin]`
  and the saved `settings.skin`, and shoots list/dialog/detail/settings
  (`SKINS="Pixel,MS-DOS"` to narrow it).

Write throwaway scenarios in `/tmp`, not in the repo.

## Gotchas

- **Launch timeouts:** the first window sometimes times out under Xvfb. The
  launcher retries 3 times.
- **No theme menu on Settings:** the sidebar `.theme-control` button is hidden
  on `#/metadata` (it shows "Back"). `pickMenu` navigates to `#/characters`
  first.
- **Focus rings on dialog close buttons:** dialog close buttons show a focus
  ring. That is `cdkTrapFocusAutoCapture`, not a bug.
- **Books need a `color`:** without it every save toasts "Book color is
  required". The seed data already has one.
- **Small text in screenshots:** small pixel fonts can look broken when a
  screenshot is scaled down (e.g. Pixelify "fi" reading as "A"). Crop or zoom
  in before calling it a bug.
- **Fonts:** check bundled fonts actually load with
  `await document.fonts.ready; document.fonts.check('16px VT323')`.
- **Errors:** a failing scenario saves `error.png` and exits 1. `PAGE ERROR`
  lines are uncaught renderer exceptions.
