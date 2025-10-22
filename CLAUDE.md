# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ensemble is an Electron + Angular 17 desktop application for character management in worldbuilding and writing projects. All data is stored as **plain text files** (markdown for characters, JSON for metadata/relationships) in user-defined work folders, enabling external editing and version control.

## Architecture

### Three-Layer Architecture

1. **UI Layer**: Angular 17 standalone components (lazy-loaded via routes)
2. **Application Layer**: Angular services managing business logic and state
3. **Data Layer**: Electron IPC bridge to Node.js file system operations

### Key Architectural Patterns

- **File-based storage**: All character data lives in work folders as `.md` files with YAML frontmatter
- **IPC communication**: Angular calls `ElectronService` → IPC handlers in `main.js` → Node.js fs operations
- **Reactive state**: Services use RxJS `BehaviorSubject` for state management
- **Standalone components**: Using Angular 17's modern standalone API (no NgModules)
- **Lazy loading**: All feature components loaded via dynamic imports in routes

### Core Services

Located in `src/app/core/services/`:

- **ElectronService**: IPC bridge to Electron main process for all file system operations (including directory operations)
- **ProjectService**: Manages work folder selection and `ensemble.json` (categories, tags, settings, relationships)
- **CharacterService**: CRUD operations for character folders, handles folder-based structure, trash management, and additional fields
- **RelationshipService**: Manages relationship data (nodes/edges) and provides data for vis.js graph
- **MetadataService**: Validates characters against project metadata (categories/tags)
- **FileWatcherService**: Monitors work folder for external file changes (using chokidar)

### Core Utilities

Located in `src/app/core/utils/`:

- **slug.utils.ts**: Slug generation for folder names, filename-to-field-name conversion, timestamp utilities
- **markdown.utils.ts**: Markdown parsing and frontmatter handling

### Data Flow

1. User action in component
2. Component calls service method
3. Service calls `ElectronService` method
4. `ElectronService` invokes IPC handler via `ipcRenderer.invoke()`
5. `main.js` IPC handler executes Node.js fs operation
6. Result returns through IPC
7. Service updates BehaviorSubject
8. Components react to observable changes

## Development Commands

### Running the Application

```bash
# Start Angular dev server only (http://localhost:4200)
npm start

# Start Electron in dev mode (opens Angular dev server in Electron window)
npm run electron-dev

# Build and run in production mode
npm run electron-prod
```

When testing your code, do not try to bring up the app. Do only the build to check for compilation errors. App may be already running and may error out on port conflicts.

### Building for Distribution

```bash
# Build for current platform
npm run build-electron

# Platform-specific builds
npm run build-electron-linux        # AppImage + .deb
npm run build-electron-linux-appimage  # AppImage only
npm run build-electron-linux-deb    # .deb only
npm run build-electron-win          # Windows (requires proper icons)
npm run build-electron-mac          # macOS (REQUIRES macOS system)

# Build all platforms (use only on macOS)
npm run dist
```

**Important**: See `PACKAGING.md` for cross-platform build limitations and CI/CD setup.

### Testing

```bash
# Run Angular tests
npm test

# Verify project setup
npm run verify
```

## Work Folder Structure

Each project has this structure:

```
project-folder/
├── ensemble.json           # Project metadata: categories, tags, settings, relationships
└── characters/             # Character folders organized by category
    ├── <category-slug>/    # Category folder (e.g., "main-character")
    │   └── <character-slug>/  # Character folder (e.g., "john-doe")
    │       ├── <character-slug>.md    # Main character file
    │       ├── thumbnail.png          # Character thumbnail (any filename)
    │       ├── additional-field.md    # Additional markdown files become fields
    │       └── img/                   # Folder for other images
    └── _deleted/           # Trash folder for deleted characters
        └── <character-slug>-<timestamp>/  # Deleted character (timestamped)
```

### Trash Management

Deleted characters are moved to `characters/_deleted/` instead of being permanently deleted:
- Each deleted character folder is timestamped: `<slug>-<timestamp>`
- Characters can be restored from trash
- Trash can be emptied to permanently delete all characters
- Individual characters can be permanently deleted from trash

### Character File Format

Main character file (`<character-slug>.md`):

```markdown
---
name: "Character Name"
category: "main-character"
tags: ["protagonist", "magic-user"]
books: ["book-id-1"]
thumbnail: "thumbnail.png"  # Filename in character folder
mangamaster: "url-to-image"
created: "2024-01-15T10:30:00Z"
modified: "2024-01-20T14:45:00Z"
---

## Description
Physical description...

## Notes
Personality, backstory...
```

### Additional Fields

Any `.md` file in the character folder (except the main file) becomes an additional field:
- `backstory.md` → "Backstory" field
- `character-arc.md` → "Character Arc" field
- Field names are auto-generated from filenames

## Key Implementation Details

### Markdown Processing

- Uses `unified/remark` ecosystem for parsing/generating markdown with YAML frontmatter
- See `src/app/core/utils/markdown.utils.ts` for frontmatter extraction/injection
- Character service handles conversion between markdown files and `Character` interface

### Graph Visualization

- Uses **vis.js Network** library for interactive relationship graphs
- `GraphViewComponent` (`src/app/features/graph-view/`) manages vis.js integration
- Node positions saved in `relationships.json` for persistence
- Supports drag-and-drop, relationship editing, colors, labels

### IPC Security Model

- **No `contextIsolation`**: Uses legacy Electron security model (for development speed)
- All file operations go through Electron main process
- `main.js` contains all IPC handlers (`ipcMain.handle()`)
- Angular accesses via `window.require('electron').ipcRenderer`

### Routing

All routes defined in `src/app/app.routes.ts`:

- `/project-selector` - Work folder selection (default route)
- `/characters` - Character list with search/filter
- `/character/:id` - Edit existing character
- `/character` - Create new character
- `/graph` - Relationship visualization (vis.js)
- `/metadata` - Manage categories/tags

## File Organization

```
src/app/
├── core/
│   ├── interfaces/     # TypeScript interfaces (Character, Project, Relationship)
│   ├── services/       # Core services (see "Core Services" above)
│   └── utils/          # Utilities (markdown parsing, validation)
├── features/           # Feature components (lazy-loaded)
│   ├── character-list/
│   ├── character-detail/
│   ├── graph-view/
│   ├── metadata-management/
│   └── project-selector/
└── app.routes.ts       # Route configuration

main.js                 # Electron main process (IPC handlers, window management)
```

## Technical Notes

### Angular 17 Modern Features

- All components are **standalone** (no NgModules)
- Uses traditional structural directives: `*ngIf`, `*ngFor` (for compatibility)
- Lazy loading via dynamic imports in routes
- Reactive forms for character editing

### Electron Integration

- Development: `main.js` loads `http://localhost:4200`
- Production: Loads from `dist/index.html`
- `nodeIntegration: true` and `contextIsolation: false` for direct Node.js access

### File System Operations

All fs operations are **atomic** where possible:
- Use `write-file-atomic` IPC handler for safe writes (temp file → rename)
- `FileWatcherService` debounces rapid changes
- Services handle race conditions when loading/saving

## Common Tasks

### Adding a New Character Field

1. Update `Character` interface in `src/app/core/interfaces/character.interface.ts`
2. Update frontmatter parsing in `CharacterService.loadCharacters()`
3. Update frontmatter generation in `CharacterService.createCharacter()` and `updateCharacter()`
4. Update form in `CharacterDetailComponent`

### Adding a New IPC Handler

1. Add handler in `main.js`: `ipcMain.handle('handler-name', async (event, ...args) => {...})`
2. Add method in `ElectronService`: `async methodName(...args) { return await this.ipcRenderer.invoke('handler-name', ...args); }`
3. Call from any service/component via `this.electronService.methodName()`

### Working with External File Changes

- `FileWatcherService` automatically monitors work folder
- Services reload data when files change externally
- Use `forceReloadCharacters()` in `CharacterService` to manually refresh

## Project Context

This project was built using **Kiro** (see `.kiro/specs/ensemble/`):
- `requirements.md` - Full requirements specification
- `design.md` - Architecture and design decisions
- `tasks.md` - Implementation task breakdown

Reference these files for understanding original requirements and design rationale.

