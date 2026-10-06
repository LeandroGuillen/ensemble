# Working with the running application

- Never launch another app instance or development server. Do not run `npm start`, `npm run electron-dev`, `npm run serve`, `ng serve`, `electron .`, or equivalent commands unless the user explicitly asks you to launch one.
- The user normally has Ensemble running already; their instance reacts to source changes. Use that existing instance for any interactive verification.
- Do not stop or restart the user's app or server. If the existing instance cannot be inspected, use builds and automated tests, and report the verification limit instead of launching another instance.
- When cleaning up processes you started, identify and stop only those exact processes. Never use broad process-name matching to kill app or server processes.
