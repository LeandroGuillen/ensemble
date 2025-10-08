# Requirements Document

## Introduction

Ensemble is a character management application designed to help writers and worldbuilders organize, develop, and track their fictional characters. The application operates within a work folder/project structure and stores all data as plain text files (markdown and JSON) that can be easily edited in any text editor. It provides both a list view for character management and an interactive graph view for visualizing and managing character relationships.

## Requirements

### Requirement 1

**User Story:** As a writer, I want to create and store character profiles as markdown files, so that I can edit them in my preferred text editor while maintaining structure.

#### Acceptance Criteria

1. WHEN a user creates a new character THEN the system SHALL allow input of Name, Category, Tags, Description, Notes, and Thumbnail
2. WHEN a user saves character information THEN the system SHALL create a markdown file in the work folder
3. WHEN a user views a character profile THEN the system SHALL display the markdown content in a formatted view
4. IF a user attempts to create a character without a name THEN the system SHALL require a name before saving
5. WHEN a user edits character files externally THEN the system SHALL reflect changes when refreshed
6. WHEN a user adds a thumbnail THEN the system SHALL store the image in a thumbnails subfolder and reference it by filename

### Requirement 2

**User Story:** As a writer, I want to work within a project/work folder structure, so that I can organize multiple writing projects separately.

#### Acceptance Criteria

1. WHEN a user opens Ensemble THEN the system SHALL allow selection or creation of a work folder
2. WHEN a user creates a work folder THEN the system SHALL initialize it with the necessary directory structure including a thumbnails subfolder
3. WHEN a user switches between work folders THEN the system SHALL load the appropriate character data and relationships
4. WHEN a user stores data THEN the system SHALL save all files within the selected work folder

### Requirement 3

**User Story:** As a writer, I want to manage project metadata including categories, tags, and other settings, so that I can maintain consistency across my character data.

#### Acceptance Criteria

1. WHEN a user creates a work folder THEN the system SHALL create a metadata JSON file to store categories, tags, and project settings
2. WHEN a user adds a new category or tag THEN the system SHALL update the metadata file
3. WHEN a user creates characters THEN the system SHALL validate categories and tags against the metadata definitions
4. WHEN a user edits the metadata file externally THEN the system SHALL refresh available options

### Requirement 4

**User Story:** As a writer, I want a list view to manage my characters, so that I can easily create, browse, and organize my character collection.

#### Acceptance Criteria

1. WHEN a user opens the list view THEN the system SHALL display all characters with their Name, Category, Tags, and Thumbnail
2. WHEN a user clicks "create new character" THEN the system SHALL open a form to input character details
3. WHEN a user selects a character from the list THEN the system SHALL open the character's detailed view
4. WHEN a user filters by category or tags THEN the system SHALL show only characters matching the selected criteria

### Requirement 5

**User Story:** As a worldbuilder, I want an interactive graph view to visualize and manage character relationships, so that I can understand complex social networks at a glance.

#### Acceptance Criteria

1. WHEN a user opens the graph view THEN the system SHALL display all characters as nodes that can be repositioned
2. WHEN a user creates a connection between characters THEN the system SHALL allow specification of relationship type with optional tag and color
3. WHEN a user rearranges characters in the graph THEN the system SHALL save the new positions
4. WHEN a user saves relationship data THEN the system SHALL store it in a JSON file within the work folder
5. WHEN a user deletes a character THEN the system SHALL remove all associated relationship connections

### Requirement 6

**User Story:** As a writer, I want to search and filter characters in the list view, so that I can quickly find specific characters in large projects.

#### Acceptance Criteria

1. WHEN a user enters search terms THEN the system SHALL search across character names, categories, tags, and descriptions
2. WHEN a user applies category or tag filters THEN the system SHALL display only characters matching the selected criteria
3. WHEN a user performs a search THEN the system SHALL highlight matching terms in the results
4. WHEN no characters match search criteria THEN the system SHALL display an appropriate message

### Requirement 7

**User Story:** As a writer, I want all data stored as plain text files, so that I can edit, backup, and version control my character data using external tools.

#### Acceptance Criteria

1. WHEN a user creates or edits characters THEN the system SHALL store data as markdown files with consistent formatting
2. WHEN a user modifies relationships THEN the system SHALL update the JSON relationships file
3. WHEN a user manages project metadata THEN the system SHALL store categories, tags, and settings in a JSON metadata file
4. WHEN a user adds thumbnails THEN the system SHALL store images in a thumbnails subfolder and reference them by filename
5. WHEN a user edits files externally THEN the system SHALL detect changes and refresh the display
6. IF a user wants to backup their project THEN they SHALL be able to copy the entire work folder