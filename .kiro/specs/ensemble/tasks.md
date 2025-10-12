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

- [x] 7. Implement books/library management system

  - [x] 7.1 Update data interfaces for books support

    - Add Book interface with required fields (id, name, color) and optional fields (description, status, publicationDate, isbn, coverImage)
    - Update ProjectMetadata interface to include books array
    - Update Character interface to include books field as string array
    - Update CharacterFormData interface to include books field
    - _Requirements: 8.1, 9.2_

  - [x] 7.2 Extend MetadataService for book management

    - Add getBooks() method to retrieve all books from metadata
    - Add getBookById(id) method to get specific book
    - Add addBook(bookData) method to create new book with validation
    - Add updateBook(id, updates) method to modify existing book
    - Add removeBook(id) method to delete book and clean up character references
    - Follow existing patterns used for categories and tags
    - _Requirements: 8.1, 8.2, 8.4_

  - [x] 7.3 Update CharacterService for book associations

    - Update frontmatter parsing to read books field from character markdown files
    - Update character creation/update methods to write books field to frontmatter
    - Ensure backward compatibility by defaulting to empty array if books field not present
    - Add validation to ensure referenced books exist in project metadata
    - _Requirements: 9.2, 9.3, 9.6_

  - [x] 7.4 Create LibraryManagementComponent

    - Build form interface for creating/editing books with all metadata fields
    - Implement list view showing all books with edit/delete actions
    - Add color picker for book visual identification
    - Include validation for required fields (name, color)
    - Add confirmation dialogs for book deletion
    - Follow UI patterns established by metadata management component
    - _Requirements: 8.1, 8.3, 8.5, 8.6_

  - [x] 7.5 Add book filtering to character list

    - Add selectedBook filter state to character list component
    - Create book dropdown in filter UI alongside category and tag filters
    - Update filterCharacters() method to filter by selected book
    - Save and restore book filter state in localStorage
    - Update filter summary display to include active book filter
    - Handle "no characters found" message when book filter yields no results
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 7.6 Add book selection to character detail component

    - Add multi-select book picker interface similar to tag selection
    - Update character form to handle book selection and validation
    - Display selected books with visual indicators using book colors
    - Save book assignments to character frontmatter on form submission
    - Allow characters to have zero, one, or multiple book assignments
    - _Requirements: 9.1, 9.3, 9.4, 9.5_

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

- [ ] 8. Implement navigation and routing

  - [ ] 8.1 Set up Angular routing

    - Configure routes for project selection, character list, graph view, and library management
    - Implement navigation guards to ensure project is selected
    - Add route resolvers for pre-loading character data
    - Add /library route loading LibraryManagementComponent with project guard
    - _Requirements: 2.3, 4.1, 8.3_

  - [ ] 8.2 Create main application shell
    - Build navigation menu with project switching
    - Add view toggle between list and graph views
    - Add "Library" navigation link to main menu
    - Implement breadcrumb navigation
    - _Requirements: 4.1, 5.1, 8.3_

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

- [-] 11. Build and package the application

  - [ ] 11.1 Configure Electron packaging
    - Set up electron-builder for cross-platform builds
    - Configure application icons and metadata
    - Test application packaging for Windows, macOS, and Linux
    - _Requirements: All requirements (deployment)_

- [ ]\* 12. Testing and quality assurance

  - [ ]\* 12.1 Write unit tests for core services

    - Test CharacterService CRUD operations including book associations
    - Test ProjectService folder management
    - Test RelationshipService data operations
    - Test MetadataService book management operations
    - Test file parsing and generation utilities with book frontmatter
    - _Requirements: All requirements_

  - [ ]\* 12.2 Create integration tests

    - Test file watcher integration with UI updates
    - Test cross-component data flow including book filtering
    - Test external file editing scenarios with book assignments
    - Test book deletion and character reference cleanup
    - _Requirements: 1.5, 7.5, 8.4, 9.6_

  - [ ]\* 12.3 Implement end-to-end tests
    - Test complete character creation and editing workflows with book assignments
    - Test graph view interactions and data persistence
    - Test project management operations
    - Test library management workflows (create, edit, delete books)
    - Test book filtering in character list view
    - _Requirements: All requirements_
