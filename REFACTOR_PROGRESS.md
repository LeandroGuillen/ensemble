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

## Batch B — IPC consistency  ·  Status: [ ]
- [ ] B1. New `core/ipc/ipc-channels.ts` shared registry; import identically in `main.js` and `electron.service.ts`. Include main→renderer events (`file-changed`, `update-status`, `browser-navigation-command`).
- [ ] B2. Promote updater channels + `ai-request` to real `ElectronService` methods. Mark `ipcRenderer` private.
- [ ] B3. Extract constants: `ENSEMBLE_JSON_FILE`, `LEGACY_METADATA_JSON_FILE`, `normalizeRelativeFolder`, default category/connection colors.
- [ ] B4. Standardize `main.js` return shape with `ok()`/`err()` helpers; never reject (`ai-request`); type `stats`; cache `get-update-status`.

## Batch C — Service-layer correctness  ·  Status: [ ]
- [ ] C1. `AiService` → `projectService.updateMetadata(...)` instead of direct `ensemble.json` write.
- [ ] C2. `CastService.mergeCastsWithMetadata` → use `projectService.getCurrentProject()?.metadata.casts`.
- [ ] C3. `MetadataService` hand-rolled frontmatter parser → `MarkdownUtils.parseMarkdown` / `generateMarkdown`.
- [ ] C4. Delete `MetadataService.generateId` (use `slugify`); migrate `metadata.service.ts:843` non-atomic write to `writeFileAtomic`.
- [ ] C5. Use `requireProject()` in the 30+ "No project loaded" sites; unify silent-return vs throw.
- [ ] C6. Replace bare `console.warn` with `logger.warn` (add `warn` to `LoggingService`).
- [ ] C7. Stop mutating `BehaviorSubject` arrays in place (character/cast/backstage) — always `.next([...shallow copy])`.

## Batch D — ProjectService decomposition  ·  Status: [ ]
- [ ] D1. Extract `PinboardStoreService` from `ProjectService` (~440 lines of pinboard CRUD).
- [ ] D2. Extract `RecentProjectsService`.
- [ ] D3. Introduce `mutateMetadata(fn)` helper; collapse the ~9 pinboard setters.
- [ ] D4. (Optional) Extract `ProjectScopedLoader<T>` base shared by `CharacterService` and `CastService`. Decide whether `CastService` subscribes to `FileWatcherService`.

## Batch E — Component decomposition  ·  Status: [ ]
- [ ] E1. Split `pinboard-view.component.ts` (1,866 lines): `PinboardNetworkService`, `PinboardCanvasInteractionService`, `PinAddDialogComponent`, `ConnectionEditDialogComponent`, `PinboardToolbarComponent`.
- [ ] E2. Split `plot-board.component.ts` (1,616 lines): `PlotBoardSidebarComponent`, `ThreadToolbarDirective`, `CellEditorPopoverComponent`, shared `EmojiPickerComponent` / `ColorSwatchPickerComponent`, `PlotBoardReorderService`.
- [ ] E3. Promote `character-detail` image picker to `shared/image-picker-dialog` + `ImagePickerService`; extract `CharacterPromptsEditorComponent`, `GeneratePortraitDialogComponent`.
- [ ] E4. Replace 17 native `confirm()` with `modalService.confirm(...)`.
- [ ] E5. Unify duplicated `getCategoryName/Color/Tooltip`, `getTagName/Color`, `getBookName/Color` via `MetadataHelperService`.
- [ ] E6. Add `PinboardService.getCurrentPinboardDataSnapshot()`; remove 5 subscribe-then-unsubscribe blocks.
- [ ] E7. Pick one drag-drop mechanism (CDK or `ReorderableDirective`); collapse metadata-management category/tag duplicate.

## Batch F — Shared UI infra  ·  Status: [ ]
- [ ] F1. `ModalFrameComponent` (role/aria-modal/Esc/focus-trap/backdrop).
- [ ] F2. `ConfirmButtonDirective` (two-click confirm + outside-click).
- [ ] F3. `_buttons.scss` / `_forms.scss` / `_modals.scss` / `_variables.scss` partials; `@use` everywhere.
- [ ] F4. Single `color-contrast.utils.ts` (WCAG) replacing two inconsistent formulas.
- [ ] F5. Route backstage markdown rendering through `markdown.utils.ts`.

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