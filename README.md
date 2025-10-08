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
├── metadata.json           # Project settings, categories, tags
├── relationships.json      # Character relationship data
├── character-1.md          # Character markdown files
├── character-2.md
└── thumbnails/            # Character thumbnail images
    ├── character-1.jpg
    └── character-2.png
```

## Technology Stack

- **Electron**: Cross-platform desktop application framework
- **Angular**: Frontend framework with TypeScript
- **vis.js**: Graph visualization library
- **chokidar**: File system watching
- **unified/remark**: Markdown processing

## License

MIT