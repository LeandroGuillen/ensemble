# Development

How to run an Ensemble development instance, and the stack it is built on. See the [README](../README.md) for the project overview.

## Prerequisites

- Node.js 20.19+, 22.12+ or 24+ (the range Angular 21 supports)
- npm or yarn

## Installation

```bash
npm install
```

## Development Server

```bash
# Full desktop app (Angular dev server + Electron). Default port 4200.
npm start

# Angular only (no Electron window)
npm run serve

# Alternate port when 4200 is already in use (e.g. another Ensemble instance)
ENSEMBLE_DEV_PORT=4301 npm start
```

`ENSEMBLE_DEV_PORT` (default `4200`) is shared by `ng serve`, `wait-on`, and the Electron window URL so they cannot drift. Invalid values fall back to 4200.

To run two Electron instances side by side without sharing recent-projects / settings, give the second a separate Chromium user-data directory. Ensemble has no app-specific user-data env; it uses Electron’s `app.getPath('userData')`. Extra flags after `--` go straight to `scripts/electron-dev.js` (`"start": "node scripts/electron-dev.js"`), then to Electron via `ENSEMBLE_ELECTRON_EXTRA_ARGS` (not through a shell). On Linux `XDG_CONFIG_HOME` also isolates config (same approach as the headless run-app skill):

```bash
# Different port + isolated userData (flags after -- reach Electron literally)
ENSEMBLE_DEV_PORT=4301 npm start -- --user-data-dir=/tmp/ensemble-dev-4301

# Linux alternative
ENSEMBLE_DEV_PORT=4301 XDG_CONFIG_HOME=/tmp/ensemble-cfg-4301 npm start
```

## Building

```bash
# Build for production
npm run build-electron
```

## Technology Stack

- **Electron**: Cross-platform desktop application framework
- **Angular**: Frontend framework with TypeScript
- **vis.js**: Graph visualization library
- **chokidar**: File system watching
- **unified/remark**: Markdown processing

Current versions of those dependencies: Electron 43, Angular 21, `vis-network`
(the graph library, used by cast pinboards), `chokidar`, `unified`/`remark`, and
CodeMirror 6 (`@codemirror/*`) for the Markdown editor.

### Tests and performance measurements

`npm test` runs the Node tests and all Angular specs. Angular discovers specs
instead of maintaining a second list of imports in `src/test.ts`; `--include`
can select a smaller suite. To reproduce CI's browser checks, run
`CHROME_BIN=/usr/bin/chromium npx ng test --watch=false --browsers=ChromeHeadless --code-coverage`
(adjust `CHROME_BIN` for your system).

Run `CHROME_BIN=/usr/bin/chromium npm run test:performance` explicitly for the
2,000-character / 4,000-page search and rendering benchmark. Its strict timing
budgets need an idle machine without coverage instrumentation. Routine tests
still exercise search, incremental indexing, and rendering behavior; they skip
this large timing benchmark because shared CI load makes wall-clock limits
unreliable.
