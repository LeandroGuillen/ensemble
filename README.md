# Ensemble

Character management application for writers and worldbuilders.

## Features

- **File-based Storage**: All data stored as plain text files (markdown and JSON)
- **Character Management**: Create, edit, and organize character profiles
- **Lore figures**: Founders, ancestors, legends, and other background figures use the full character editor, with only a name required. Characters, Lore, and Drawer have separate counters and saved filters. Lore figures appear in character pickers with a Lore label; drafts remain excluded.
- **Houses**: Family and dynasty profiles with crests, mottos, colors, seats, multiple character memberships, and ordered leadership history. Reigns support joint heads, periods, notes, optional book references, and an explicit current leadership entry.
- **Relationship Visualization**: Interactive graph view for character relationships
- **Project Organization**: Work with multiple projects in separate folders
- **External Editing**: Saved Markdown edits from apps such as Obsidian refresh character lists and open character pages in Ensemble. If both apps edit the same file, Ensemble asks you to reload before saving.

## Development

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

```bash
npm install
```

### Development Server

```bash
# Start Angular development server
npm run start

# Start Electron in development mode
npm run electron-dev
```

### Building

```bash
# Build for production
npm run build-electron
```

## Testing Linux packages

Run the **Build and Release** workflow manually from GitHub Actions to build Linux
artifacts and smoke test them without publishing a release. Every tagged release
runs the same checks before publishing:

- A clean Debian container installs the DEB and opens an Ensemble window under Xvfb.
- A separate Debian container runs the AppImage with its extract-and-run fallback.
- A clean Fedora container installs the RPM and opens an Ensemble window under Xvfb.

These jobs test the generated artifacts and package dependencies on other Linux
userlands. They do not exercise FUSE mounting, desktop integration, a real user
session, package manager authentication, or installation of an update over an
older version. Use full Debian and Fedora VMs for those final release checks.

## Project Structure

```
project-folder/
├── ensemble.json           # Project metadata: categories, tags, settings, lastSession, relationships
├── houses/                 # Family and dynasty records
│   └── house-stark/
│       └── house-stark.md   # House frontmatter + Markdown history
└── characters/             # Configurable character root
    ├── roger-rabbit/
    │   ├── roger-rabbit.md       # Main file (frontmatter + description)
    │   ├── roger-rabbit.n26.md   # Book page, keyed by book code
    │   ├── portrait.webp          # Selected style thumbnail
    │   └── reference.psd          # Unrecognized files are ignored
    └── @drafts/                   # Draft character folders
        └── unnamed-a1b2c3/
            └── unnamed-a1b2c3.md
```

Folder names are derived from an ASCII-only transliteration of the character name
(`José García` becomes `jose-garcia`). If that slug is already in use, Ensemble
appends part of the stable character ID. The former `_name.md` layout is still
readable for compatibility, but newly created characters use this structure.

## Technology Stack

- **Electron**: Cross-platform desktop application framework
- **Angular**: Frontend framework with TypeScript
- **vis.js**: Graph visualization library
- **chokidar**: File system watching
- **unified/remark**: Markdown processing

## Releases and updates

Push a tag matching `package.json` (for example, `v1.14.5`) to run the release
workflow. It builds AppImage, DEB, and RPM packages on Linux. When macOS signing
credentials are configured, it also builds signed, notarized DMG and ZIP
packages for both macOS architectures. One publish job uploads the packages
and their update metadata to the same GitHub release. The update feed needs
both the package and its metadata; uploading an installer alone is insufficient.

Before tagging, add these repository Actions secrets for the macOS build:

- `MAC_CERTIFICATE`: base64 encoded Developer ID Application `.p12` certificate
- `MAC_CERTIFICATE_PASSWORD`: password for that certificate
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`: Apple notarization credentials

Without any macOS credentials, the workflow publishes Linux packages only.
Partially configured credentials fail the release. macOS automatic updates
require the installed app and its replacement to be signed.
Anyone using an earlier unsigned macOS build should install the first signed
release manually, then subsequent releases can update in the app.

Installed builds check GitHub Releases at startup and every four hours. Users
can also check in Settings. When an update is ready, **Quit and Install** asks
`electron-updater` to install the package matching the current platform.
Linux AppImage users should keep the AppImage in a directory they can write to,
so the updater can replace it. DEB and RPM installs use their respective package
managers and may request administrator authentication. Builds run from source do
not update themselves.

## License

MIT

## Houses

Houses are stored under `houses/`, one folder per House. The main Markdown file
has `type: house` in its YAML frontmatter. Crests use the same project image
references as character thumbnails. Membership is stored in the House's
`characterIds`; characters may belong to multiple Houses, regardless of book.
Membership selections in the character editor are committed with Save Changes.

The `leadership` array is chronological, oldest to newest: its saved array order
is authoritative. Each entry has a stable `id`, `characterIds` (one or more
joint heads), optional `period` and `notes`, and `books` containing optional book
IDs. Dates and book references do not sort entries. Repeated characters across
entries represent interrupted reigns. `currentLeadershipId` explicitly marks
the current reign; an omitted value means unspecified or no current head.
External Markdown edits refresh Houses. Open editors with unsaved changes require
a reload before saving a changed file. Deleting a House preserves characters
and other files in its folder.

## Lore figures

Lore uses the same character files and editor as Characters. Set `lore: true` in
a record's frontmatter to place it in the Lore collection. Only the name is
required; images, category, tags, books, descriptions, and other details are
optional. The editor's Collection switch moves records between Characters and
Lore while preserving their IDs, files, and references.

Lore figures can be House members, historical leaders, cast members, and other
character references. Character pickers show them with a **Lore** label.
Drawer drafts remain separate and are excluded from those pickers.

Drawer drafts can be converted from their editor using **Convert to Character**
or **Convert to Lore**. Characters require a name and category; Lore figures
require only a name. Conversion saves current edits and book notes, preserves
the record's ID and images, and moves its folder out of `@drafts/`.

## Locations

Locations have an optional Type: Country, Region, Settlement, District, Building,
Natural Feature, Continent, Plane, or Other. The editor includes explanations and
examples for each type. Types are stored in Markdown frontmatter as `type` (for
example, `type: settlement` or `type: natural-feature`). Existing locations without
a type remain Unspecified.

The Locations page displays type badges in grid and list views. Search matches
names, descriptions, book names, and type labels. Type, book, and picture filters
can be combined; their selections are remembered, and Clear Filters resets them.
The toolbar wraps below the page title as space becomes limited.
