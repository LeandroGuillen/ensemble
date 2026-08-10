# Refactor Round — Progress Tracker

Status legend: `[ ]` pending · `[~]` in progress · `[x]` done · `[!]` blocked

Git: one commit per batch. Verify with `npm run build` (and `npm test` if applicable) before each commit.

---

## Batch A — Dead code & removed-feature sweep  ·  Status: [x]
- [x] A1. Delete ~250 lines of dead "relationship/graph" wrappers in `PinboardService`
      (`getGraphData`, `loadRelationships`, `createRelationship`, `updateRelationship`,
      `deleteRelationship`, `updateNodePosition`, `ensureNodesForCharacters`,
      `syncNodesWithCharacters`, `removeCharacterRelationships`, `saveRelationshipsToFile`,
      `addNode`, `debugLogGraphState`, `getRelationshipTypes`, no-thumbnail `getVisJsData`).
      Keep only `getVisJsDataWithThumbnails`. Also dropped unused `ElectronService` import
      from `PinboardService` constructor (was injected, never used).
- [x] A2. Delete slideshow / `characterImagesDataUrls` machinery in `character-list.component.ts`
      + grid/gallery views (~250 lines, unreachable). Also removed dead stubs
      `getThumbnailPath`, `getThumbnailDataUrl`, `getCharacterImages`, `toggleSlideshow`,
      the `characterSlideshowEnabled` localStorage read, and the slideshow toggle button
      + `[characterImagesDataUrls]`/`[slideshowEnabled]` bindings. Slideshow-image fade
      CSS in grid/gallery scss removed.
- [x] A3. Delete dead `MetadataService.createDefaultMetadata` (dead; ProjectService's version
      is the only one called) — also removed now-unused `COLOR_PALETTE` import. Delete
      `CharacterService.relocateCharactersForCategory` (body was `return 0`); removed the
      now-dead caller block in `metadata-management.component.ts` saveCategory (the
      `needsRelocation`/`categoryId` locals and the if block).
- [x] A4. Delete `ImageCategoryService` (zero consumers) + its barrel export + the
      `ProjectMetadata.imageTags` field (only the service read it). No image-generation
      flow references `imageTags`.
- [x] A5. Remove unused `ElectronService` injection from `pinboard-view.component.ts`
      constructor.
- [x] (baseline) Folded in pre-existing uncommitted removals: graph-view component, trash-dialog, file.utils, migrate-to-folder-structure.js, test-electron.js, CLAUDE.md refresh. (Build verified green.)

## Batch B — IPC consistency  ·  Status: [x]
- [x] B1. New `core/ipc/ipc-channels.ts` shared registry; import identically in `main.js` and `electron.service.ts`. Include main→renderer events (`file-changed`, `update-status`, `browser-navigation-command`).
      Single source of truth: `ipc-channels.json` at project root (Node `require`s it; Angular imports it via the typed `core/ipc/ipc-channels.ts` wrapper). Added to electron-builder `files` so packaged builds include it. `main.js` and `ElectronService` no longer hardcode channel literals — every `ipcMain.handle`/`webContents.send`/`ipcRenderer.invoke`/`.on` reads from the registry.
- [x] B2. Promote updater channels + `ai-request` to real `ElectronService` methods. Mark `ipcRenderer` private.
      `ElectronService.ipcRenderer` is now `private`; updater methods (`onUpdateStatus`/`removeUpdateStatusListener`/`checkForUpdates`/`downloadUpdate`/`getUpdateStatus`/`quitAndInstall`/`copyUpdateToDownloads`/`openUpdateFolder`) added. `update.service.ts` and `ai.service.ts` no longer touch `ipcRenderer` directly.
- [x] B3. Extract constants: `ENSEMBLE_JSON_FILE`, `LEGACY_METADATA_JSON_FILE`, `normalizeRelativeFolder`, default category/connection colors.
      New `core/constants/project.constants.ts` exports those plus `DEFAULT_CATEGORIES`/`DEFAULT_TAGS` seeds and `DEFAULT_CONNECTION_COLOR`/`DEFAULT_CONNECTION_LABEL_COLOR`. `ProjectService`, `CastService`, `AiService`, `ImageGenerationService`, `FileWatcherService`, `ProjectSelectorComponent`, `PinboardService`, `PinboardViewComponent`, and `main.js` all consume them. `COLOR_PALETTE` import dropped from `ProjectService`.
- [x] B4. Standardize `main.js` return shape with `ok()`/`err()` helpers; never reject (`ai-request`); type `stats`; cache `get-update-status`.
      `ok()`/`err()` helpers + `FileStatsResult` JSDoc typedef added; fs handlers return via them. `ai-request` never rejects (resolves `{ success:false, error }` on failure) and `AiService.makeHttpRequest` translates the error payload back into a thrown exception so callers see no behaviour change. `get-update-status` caches results (5-min TTL) and is busted on manual `check-for-updates`.

## Batch C — Service-layer correctness  ·  Status: [x]
- [x] C1. `AiService` → `projectService.updateMetadata(...)` instead of direct `ensemble.json` write.
- [x] C2. `CastService.mergeCastsWithMetadata` → use `projectService.getCurrentProject()?.metadata.casts`.
- [x] C3. `MetadataService` book-reference cleanup → `MarkdownUtils.parseMarkdown` / `generateMarkdown`.
- [x] C4. Delete `MetadataService.generateId` (use `slugify`); migrate the cleanup write to `writeFileAtomic`.
- [x] C5. Use `requireProject()` in the 30+ "No project loaded" sites; service-layer guards migrated where touched in this batch. Remaining guards need an operation-by-operation silent-return/throw decision.
      Throw via `requireProject`: PinboardService mutations, ProjectService path getters
      (`getCastsFolderPath`/`getNamesFilePath`), CharacterService book validators,
      MetadataService.saveMetadata, metadata/library `loadData`. Keep silent return for
      session persistence writes, soft queries/thumbnails, theme default fallback, and
      plot-board Result APIs (`{ success:false, error:'No project loaded' }`).
- [x] C6. Replace service-layer bare `console.warn` with `logger.warn` and add `warn` to `LoggingService`.
- [x] C7. Stop mutating `BehaviorSubject` arrays in place (character/cast/backstage) — always emit shallow-copied arrays.

## Batch D — ProjectService decomposition  ·  Status: [x]
- [x] D1. Extract `PinboardStoreService` from `ProjectService` (~440 lines of pinboard CRUD), retaining compatibility façades on `ProjectService`.
- [x] D2. Extract `RecentProjectsService`.
- [x] D3. Introduce `mutateMetadata(fn)` helper; collapse the pinboard mutation façades.
- [ ] D4. (Optional) Extract `ProjectScopedLoader<T>` base shared by `CharacterService` and `CastService`. Deferred as optional follow-up.

## Batch E — Component decomposition  ·  Status: [x]
- [x] E1. Split `pinboard-view.component.ts` (1,866 lines): `PinboardNetworkService`, `PinboardCanvasInteractionService`, `PinAddDialogComponent`, `ConnectionEditDialogComponent`, `PinboardToolbarComponent`.
      Parent now ~627 lines; network/canvas services provided on the feature component;
      toolbar + pin-add + connection-edit dialogs extracted under `features/pinboard-view/components/`.
- [x] E2. Split `plot-board.component.ts` (1,616 lines): `PlotBoardSidebarComponent`, `ThreadToolbarDirective`, `CellEditorPopoverComponent`, shared `EmojiPickerComponent` / `ColorSwatchPickerComponent`, `PlotBoardReorderService`.
      Parent now ~982 lines; shared emoji/color pickers under `shared/`; thread toolbar =
      service + component; sidebar owns file-list dialogs.
- [x] E3. Promote `character-detail` image picker to `shared/image-picker-dialog` + `ImagePickerService`; extract `CharacterPromptsEditorComponent`, `GeneratePortraitDialogComponent`.
      Parent now ~1221 lines; image browse/history in `ImagePickerService`.
- [x] E4. Replace native `confirm()` with `modalService.confirm(...)`; migrated confirmations in backstage, cast list/detail, library management, metadata management, and project selector. Remaining confirmations need follow-up.
      Finished remaining native confirms in pinboard-view, book-editor, and name-list-card.
- [x] E5. `MetadataHelperService` is now used by character-list; remaining input-scoped component helpers need follow-up.
      Adopted in character list/grid/compact views, character-filter, cast-detail, cast-list,
      pin-add dialog, and character-detail (via prior E3 pass).
- [x] E6. Add `PinboardService.getCurrentPinboardDataSnapshot()`; remove temporary subscribe-then-unsubscribe blocks from pinboard view.
- [x] E7. Pick one drag-drop mechanism (CDK or `ReorderableDirective`); collapse metadata-management category/tag duplicate.
      Chose CDK (`cdkDropList`/`moveItemInArray`) for same-list reorder in metadata categories
      and tags (matches character-list CDK usage). Removed duplicated HTML5 DnD handlers.

## Batch F — Shared UI infra  ·  Status: [x]
- [x] F1. `ModalFrameComponent` (role/aria-modal/Esc/focus-trap/backdrop).
      Shared frame under `shared/modal-frame/` with CDK `cdkTrapFocus`, Esc/backdrop
      close, and focus restore. Migrated confirmation, pinboard create/rename,
      pin-add, and connection-edit dialogs onto it.
- [x] F2. `ConfirmButtonDirective` (two-click confirm + outside-click).
      `button[appConfirmButton]` arms on first click, confirms on second, disarms on
      outside click / Esc. Adopted for plot-board thread, row, and cell delete.
- [x] F3. `_buttons.scss` / `_forms.scss` / `_modals.scss` / `_variables.scss` partials; `@use` everywhere.
      Partials live in `src/styles/`; `styles.scss` `@use`s them. `angular.json`
      `stylePreprocessorOptions.includePaths` includes `src` for `@use 'styles/...'`.
- [x] F4. Single `color-contrast.utils.ts` (WCAG) replacing two inconsistent formulas.
      Character list and cast detail now call `contrastTextColor()` (relative luminance
      + equal-contrast threshold ~0.179).
- [x] F5. Route backstage markdown rendering through `markdown.utils.ts`.
      Added `MarkdownUtils.escapeHtml` / `markdownToHtml`; backstage `renderMarkdown`
      and `formatNameForDisplay` consume them (still DomSanitizer-gated).

## Batch G — main.js split & safety  ·  Status: [ ]
- [ ] G1. Split `main.js` into `main.js` + `lib/{window,fs-handlers,path-handlers,dialog-handlers,file-watcher,ai-http,updater}.js` with `register(ipcMain, deps)` exports. Collapse duplicated updater cache-search.
- [ ] G2. Add `assertPathInsideWorkFolder` guard + `set-work-folder` channel. Whitelist `recent-projects.json`, update downloads, OS temp.
- [ ] G3. Fix `write-file-atomic` fallback (no raw target overwrite). Migrate `backstage.service.ts` non-atomic writers.
- [ ] G4. Replace ad-hoc glob with `picomatch` (or escaped regex); remove `_*.md` special case.
- [ ] G5. Remove four pure path IPC channels (`pathJoin`/`pathBasename`/`pathDirname`/`sanitizeFilename`); migrate callers to `path.utils.ts`/`slug.utils.ts`.

## Batch H — Types & utils polish  ·  Status: [ ]
- [ ] H1. Fix `Character.created/modified: Date` vs `CharacterFrontmatter.created?: string`; backfill from `fs.stat` mtime when missing.
- [ ] H2. Move deprecated `currentPinboardId` and `bidirectional` to legacy interfaces used only by the loader.
- [ ] H3. Complete interfaces barrel (`theme`, `color-palette`); convert `MarkdownUtils` static class to module functions.
- [ ] H4. Fix `JsonUtils.deepEqual` (stringify is order-sensitive); document `deepClone` JSON-only contract.
- [ ] H5. Align `pathDirname` with `path.posix.dirname`; align `slugToId` trailing hyphen with `slugify`; drop deprecated `COLOR_PALETTE`.
- [ ] H6. Adopt `takeUntilDestroyed()` in 8 services + eligible components.
- [ ] H7. (Optional, riskiest) `OnPush` for large components after E1/E2/E3; remove `detach/reattach` hack in `character-detail`.

---

## Notes
- Build command: `npm run build`. Tests: `npm test` (Karma + Chromium). Lint: `npm run lint`.
- Do not run the Electron app while iterating (port conflicts per CLAUDE.md).
- Per-batch commit, no `--amend`, no force-push, no empty commits.
