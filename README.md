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
├── ensemble.json           # Project metadata: categories, tags, settings, relationships
└── characters/             # Character folders organized by category
    ├── <category-slug>/    # Category folder (e.g., "main-characters")
    │   └── <character-slug>/  # Character folder (e.g., "john-doe")
    │       ├── <character-slug>.md    # Main character file
    │       ├── thumbnail.png          # Character thumbnail (any image format)
    │       └── additional-field.md    # Additional markdown files become fields
    └── _deleted/           # Trash folder for deleted characters
```

### Migrating from Old Structure

If you have an existing project with a global `thumbnails/` directory, use the migration script:

```bash
node scripts/migrate-to-folder-structure.js /path/to/your/project
```

See [THUMBNAILS_MIGRATION.md](THUMBNAILS_MIGRATION.md) for detailed migration instructions.

## Technology Stack

- **Electron**: Cross-platform desktop application framework
- **Angular**: Frontend framework with TypeScript
- **vis.js**: Graph visualization library
- **chokidar**: File system watching
- **unified/remark**: Markdown processing

## License

MIT
