# Ensemble

Character management application for writers and worldbuilders.

## Features

- **File-based Storage**: All data stored as plain text files (markdown and JSON)
- **Character Management**: Create, edit, and organize character profiles
- **Relationship Visualization**: Interactive graph view for character relationships
- **Project Organization**: Work with multiple projects in separate folders
- **External Editing**: Edit files in your preferred text editor

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

## Project Structure

```
project-folder/
├── ensemble.json           # Project metadata: categories, tags, settings, lastSession, relationships
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

## License

MIT
