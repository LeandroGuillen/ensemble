# Design Document

## Overview

Ensemble is a desktop application built for character management in worldbuilding and writing projects. The application follows a file-based approach where all data is stored as plain text files (markdown and JSON) within user-defined work folders. This design enables external editing, version control, and easy backup while providing a rich user interface for character management and relationship visualization.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Ensemble Application                     │
├─────────────────────────────────────────────────────────────┤
│  UI Layer                                                   │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │   List View     │  │   Graph View    │                  │
│  │   Component     │  │   Component     │                  │
│  └─────────────────┘  └─────────────────┘                  │
├─────────────────────────────────────────────────────────────┤
│  Application Layer                                          │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │   Character     │  │  Relationship   │                  │
│  │   Manager       │  │   Manager       │                  │
│  └─────────────────┘  └─────────────────┘                  │
├─────────────────────────────────────────────────────────────┤
│  Data Layer                                                 │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │   File System   │  │   File Watcher  │                  │
│  │   Interface     │  │   Service       │                  │
│  └─────────────────┘  └─────────────────┘                  │
├─────────────────────────────────────────────────────────────┤
│  Storage Layer (Work Folder)                               │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │   Characters/   │  │   thumbnails/   │                  │
│  │   *.md files    │  │   image files   │                  │
│  └─────────────────┘  └─────────────────┘                  │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │  metadata.json  │  │relationships.json│                 │
│  └─────────────────┘  └─────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

### Technology Stack

- **Frontend Framework**: Electron with Angular 17+ (standalone components) and TypeScript for cross-platform desktop application
- **Graph Visualization**: vis.js Network for easy implementation with built-in interactions
- **File Operations**: Node.js fs module with chokidar for file watching
- **Markdown Processing**: Unified/remark ecosystem for parsing and rendering
- **State Management**: Angular services with RxJS for reactive state management
- **Modern Angular Features**: Standalone components, traditional structural directives (*ngIf, *ngFor), and reactive state management

### Visualization Options Analysis

**vis.js Network** (recommended for ease of development):
- ✅ Very easy to use with minimal setup
- ✅ Built-in physics simulation for automatic positioning
- ✅ Drag and drop functionality out of the box
- ✅ Good documentation and examples
- ✅ Handles node/edge styling automatically
- ✅ Built-in zoom and pan controls
- ✅ Event handling for interactions

**Cytoscape.js**:
- ✅ Designed specifically for graph visualization
- ✅ Built-in layout algorithms
- ✅ Good performance with large graphs
- ❌ More complex API than vis.js
- ❌ Requires more configuration

**Plain SVG Approach**:
- ❌ Significant development time for drag/drop
- ❌ Manual implementation of positioning algorithms
- ❌ Complex event handling for interactions
- ❌ Need to build zoom/pan from scratch

**Recommendation**: Use vis.js Network for fastest development with excellent out-of-the-box functionality. The time saved on implementation far outweighs the dependency cost.

## Components and Interfaces

### Work Folder Structure

```
project-folder/
├── metadata.json           # Project settings, categories, tags
├── relationships.json      # Character relationship data
├── character-1.md          # Character markdown files
│── character-2.md
│   ...
└── thumbnails/           # Character thumbnail images
    ├── character-1.jpg
    ├── character-2.png
    └── ...
```

### Character File Format

Each character is stored as a markdown file with YAML frontmatter:

```markdown
---
name: "Character Name"
category: "Main Character"
tags: ["protagonist", "magic-user"]
thumbnail: "character-name.jpg"
created: "2024-01-15T10:30:00Z"
modified: "2024-01-20T14:45:00Z"
---

# Character Name

## Description

Physical description and appearance details...

## Notes

Character development notes, personality traits, backstory...
```

### Metadata File Structure

```json
{
  "projectName": "My Fantasy World",
  "version": "1.0.0",
  "categories": [
    {
      "id": "main-character",
      "name": "Main Character",
      "color": "#3498db"
    },
    {
      "id": "supporting",
      "name": "Supporting Character", 
      "color": "#2ecc71"
    }
  ],
  "tags": [
    {
      "id": "magic-user",
      "name": "Magic User",
      "color": "#9b59b6"
    }
  ],
  "settings": {
    "defaultCategory": "main-character",
    "autoSave": true,
    "fileWatchEnabled": true
  }
}
```

### Relationships File Structure

```json
{
  "nodes": [
    {
      "id": "character-1",
      "name": "Character Name",
      "position": { "x": 100, "y": 150 }
    }
  ],
  "edges": [
    {
      "id": "rel-1",
      "source": "character-1",
      "target": "character-2",
      "type": "family",
      "label": "sibling",
      "color": "#e74c3c",
      "bidirectional": true
    }
  ]
}
```

### Angular-Specific Architecture

**Modern Angular 17+ Features**:
- **Standalone Components**: All components are standalone, eliminating the need for NgModules
- **Traditional Structural Directives**: Using *ngIf, *ngFor for template logic (for compatibility)
- **Lazy Loading**: Components are lazy-loaded using dynamic imports in routes
- **Application Config**: Using `bootstrapApplication` with `ApplicationConfig` instead of module-based bootstrapping
- **Barrel Exports**: Organized imports using index.ts files for cleaner code structure

**Services**:
- `CharacterService`: Manages character CRUD operations
- `ProjectService`: Handles work folder and metadata management  
- `RelationshipService`: Manages graph data and relationships
- `FileWatcherService`: Monitors external file changes

**Standalone Components**:
- `CharacterListComponent`: Displays character grid/list with filtering
- `CharacterDetailComponent`: Character editing form with reactive forms
- `GraphViewComponent`: vis.js-based relationship visualization
- `ProjectSelectorComponent`: Work folder selection and management

**Routing**:
- Modern route-based lazy loading with dynamic imports
- No need for routing modules with standalone components

### Core Interfaces

#### Character Interface
```typescript
interface Character {
  id: string;
  name: string;
  category: string;
  tags: string[];
  thumbnail?: string;
  description: string;
  notes: string;
  created: Date;
  modified: Date;
  filePath: string;
}
```

#### Relationship Interface
```typescript
interface Relationship {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
  color: string;
  bidirectional: boolean;
}
```

#### Project Metadata Interface
```typescript
interface ProjectMetadata {
  projectName: string;
  version: string;
  categories: Category[];
  tags: Tag[];
  settings: ProjectSettings;
}

interface Category {
  id: string;
  name: string;
  color: string;
}

interface Tag {
  id: string;
  name: string;
  color: string;
}
```

## Data Models

### Character Manager
- Handles CRUD operations for character files
- Manages markdown parsing and generation
- Validates character data against metadata
- Handles thumbnail file operations

### Relationship Manager  
- Manages the relationships.json file
- Provides graph data for visualization
- Handles relationship CRUD operations
- Maintains referential integrity

### File Watcher Service
- Monitors work folder for external changes
- Triggers UI updates when files are modified
- Handles file creation, deletion, and modification events
- Debounces rapid file changes

### Project Manager
- Handles work folder selection and initialization
- Manages metadata.json file
- Provides project-wide settings and configuration
- Handles project switching

## Error Handling

### File System Errors
- **File Not Found**: Graceful handling with user notification and recovery options
- **Permission Errors**: Clear error messages with suggested solutions
- **Disk Space**: Warning when approaching storage limits
- **Corrupted Files**: Backup and recovery mechanisms

### Data Validation Errors
- **Invalid Markdown**: Fallback parsing with error highlighting
- **Missing Required Fields**: Form validation with clear error messages
- **Invalid JSON**: Schema validation with detailed error reporting
- **Broken References**: Automatic cleanup of orphaned relationships

### Application Errors
- **Memory Issues**: Efficient loading for large character collections
- **Performance**: Lazy loading and virtualization for large datasets
- **Network Issues**: Offline-first design with local file operations

## Testing Strategy

### Unit Testing
- Character file parsing and generation
- Metadata validation and management
- Relationship data operations
- File system utilities

### Integration Testing
- File watcher integration with UI updates
- Cross-component data flow
- Project switching workflows
- External file editing scenarios

### End-to-End Testing
- Complete character creation and editing workflows
- Graph view interactions and data persistence
- Project management operations
- File system integration scenarios

### Performance Testing
- Large character collection handling (1000+ characters)
- Graph rendering performance with complex relationships
- File watching efficiency with rapid changes
- Memory usage optimization

## Security Considerations

### File System Access
- Restrict file operations to selected work folders
- Validate file paths to prevent directory traversal
- Handle symbolic links appropriately
- Implement safe file deletion with confirmation

### Data Integrity
- Atomic file operations to prevent corruption
- Backup mechanisms for critical data
- Validation of external file modifications
- Recovery procedures for data loss scenarios