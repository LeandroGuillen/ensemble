# Implementation Plan

- [x] 1. Set up project structure and core dependencies

  - Initialize Electron + Angular project with TypeScript
  - Install required dependencies: vis.js, chokidar, unified/remark, electron-builder
  - Configure Angular for Electron environment
  - Set up basic project structure with services and components folders
  - _Requirements: 2.1, 2.2_

- [x] 2. Implement core data models and interfaces

  - [x] 2.1 Create TypeScript interfaces for Character, Relationship, and ProjectMetadata

    - Define all data structures matching the design document
    - Include validation schemas for data integrity
    - _Requirements: 1.1, 3.1, 4.1_

  - [x] 2.2 Implement file system utilities
    - Create utilities for reading/writing markdown files with YAML frontmatter
    - Implement JSON file operations for metadata and relationships
    - Add file path validation and error handling
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 3. Create project management system

  - [x] 3.1 Implement ProjectService for work folder management

    - Handle work folder selection and initialization
    - Create directory structure (characters/, thumbnails/)
    - Generate initial metadata.json with default categories and tags
    - _Requirements: 2.1, 2.2, 3.1_

  - [x] 3.2 Build project selector component
    - Create UI for selecting existing or creating new work folders
    - Implement folder browser dialog integration
    - Add recent projects list functionality
    - _Requirements: 2.1, 2.3_

- [x] 4. Implement character management system

  - [x] 4.1 Create CharacterService for CRUD operations

    - Implement character file parsing from markdown with frontmatter
    - Handle character creation, reading, updating, and deletion
    - Manage thumbnail file operations and references
    - _Requirements: 1.1, 1.2, 1.6, 7.1_

  - [x] 4.2 Build character list component

    - Create grid/list view displaying characters with thumbnails
    - Implement search functionality across names, categories, tags, and descriptions
    - Add category and tag filtering with multi-select options
    - Include "create new character" button and functionality
    - _Requirements: 4.1, 4.2, 4.4, 6.1, 6.2_

  - [x] 4.3 Create character detail/edit component
    - Build form for editing character properties (name, category, tags, description, notes)
    - Implement thumbnail upload and management
    - Add category and tag selection with validation against metadata
    - Include save/cancel functionality with proper error handling
    - _Requirements: 1.1, 1.3, 1.4, 4.3_

- [x] 5. Implement metadata management

  - [x] 5.1 Create MetadataService for categories and tags

    - Handle metadata.json file operations
    - Provide CRUD operations for categories and tags
    - Implement validation for character data against metadata definitions
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 5.2 Build metadata management UI
    - Create interface for adding/editing categories with color selection
    - Implement tag management with color coding
    - Add project settings configuration
    - _Requirements: 3.1, 3.2_

- [x] 6. Create relationship management system

  - [x] 6.1 Implement RelationshipService

    - Handle relationships.json file operations
    - Provide CRUD operations for character relationships
    - Maintain referential integrity when characters are deleted
    - Convert data format for vis.js Network consumption
    - _Requirements: 5.1, 5.4, 5.5_

  - [x] 6.2 Build graph view component with vis.js
    - Integrate vis.js Network for interactive graph visualization
    - Display characters as nodes with thumbnails and names
    - Implement drag and drop for node positioning
    - Add relationship creation through node connections
    - Include relationship editing with type, label, and color selection
    - Save node positions and relationship data to JSON file
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 7. Implement file watching and external editing support

  - [ ] 7.1 Create FileWatcherService

    - Set up chokidar to monitor work folder for file changes
    - Handle file creation, modification, and deletion events
    - Implement debouncing for rapid file changes
    - Trigger UI updates when external changes are detected
    - _Requirements: 1.5, 7.5_

  - [ ] 7.2 Add external editing integration
    - Detect when markdown files are modified externally
    - Refresh character data and UI when files change
    - Handle metadata.json and relationships.json external modifications
    - Provide conflict resolution for simultaneous edits
    - _Requirements: 3.4, 7.5_

- [ ] 8. Implement navigation and routing

  - [ ] 8.1 Set up Angular routing

    - Configure routes for project selection, character list, and graph view
    - Implement navigation guards to ensure project is selected
    - Add route resolvers for pre-loading character data
    - _Requirements: 2.3, 4.1_

  - [ ] 8.2 Create main application shell
    - Build navigation menu with project switching
    - Add view toggle between list and graph views
    - Implement breadcrumb navigation
    - _Requirements: 4.1, 5.1_

- [ ] 9. Add search and filtering functionality

  - [ ] 9.1 Implement advanced search service
    - Create full-text search across character content
    - Add filtering by multiple categories and tags simultaneously
    - Implement search result highlighting
    - Handle empty search results with appropriate messaging
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 10. Implement error handling and data validation

  - [ ] 10.1 Add comprehensive error handling
    - Handle file system errors with user-friendly messages
    - Implement data validation for all user inputs
    - Add recovery mechanisms for corrupted files
    - Create backup functionality for critical operations
    - _Requirements: 1.4, 3.3, 7.6_

- [ ] 11. Build and package the application

  - [ ] 11.1 Configure Electron packaging
    - Set up electron-builder for cross-platform builds
    - Configure application icons and metadata
    - Test application packaging for Windows, macOS, and Linux
    - _Requirements: All requirements (deployment)_

- [ ]\* 12. Testing and quality assurance

  - [ ]\* 12.1 Write unit tests for core services

    - Test CharacterService CRUD operations
    - Test ProjectService folder management
    - Test RelationshipService data operations
    - Test file parsing and generation utilities
    - _Requirements: All requirements_

  - [ ]\* 12.2 Create integration tests

    - Test file watcher integration with UI updates
    - Test cross-component data flow
    - Test external file editing scenarios
    - _Requirements: 1.5, 7.5_

  - [ ]\* 12.3 Implement end-to-end tests
    - Test complete character creation and editing workflows
    - Test graph view interactions and data persistence
    - Test project management operations
    - _Requirements: All requirements_
