# TODO - Future Features

## Recently Completed

### Thumbnails Migration ✅

- **Completed**: Migrated from global `thumbnails/` directory to character folder structure
- **Status**: Migration script available, documentation updated, deprecated code marked
- **Files**: See `THUMBNAILS_MIGRATION.md` for migration guide

## Currently Planned

### Scene Board / Reference View

Create a dedicated visual scene composition view with the following features:

- Dedicated route/page for scene board visualization
- Large, gallery-style character thumbnails
- Visual arrangement and composition tools
- Ability to organize and rearrange characters spatially
- Save multiple scene compositions
- Export/share scene boards
- Potentially drag-and-drop interface for scene planning

This would be a more immersive alternative to the Cast filter in the character list, providing a dedicated workspace for visual scene planning and reference while writing.

**Related to**: Cast feature (implemented) - Casts provide the data structure, Scene Board would provide the visual workspace.

---

## Core Character Management Enhancements

### Character Templates

**Complexity**: Low | **Value**: Medium | **Quick Win**

- Predefined character templates (e.g., "Fantasy Hero", "Villain", "Supporting")
- Custom template creation
- Include common fields/sections for different character types
- Speed up character creation workflow

### Timeline/Chronicle View

**Complexity**: Medium | **Value**: High

- Track character events chronologically (births, deaths, story events)
- Visual timeline showing when characters appear in your story
- Could integrate with scenes/chapters
- Essential for complex narratives with non-linear timelines

### Character Arc Tracking

**Complexity**: Medium | **Value**: High

- Track character development stages across story arcs
- Before/during/after character states
- Visual progression indicators
- Help writers maintain consistent character development

### Comparison View

**Complexity**: Low | **Value**: Medium

- Side-by-side comparison of 2-4 characters
- Useful for identifying inconsistencies or similarities
- Compare any field (description, tags, relationships)
- Quick consistency checking

---

## Visualization & Discovery

### Statistics Dashboard

**Complexity**: Medium | **Value**: Medium

- Overview of your character collection
- Category/tag distribution charts
- Relationship network statistics (most connected, isolated characters)
- Character creation timeline
- Great for project insights and overview

### Advanced Filtering & Search

**Complexity**: Medium | **Value**: High

- Boolean search operators (AND, OR, NOT)
- Search within specific fields only
- Saved search queries
- Search by relationship type
- More powerful than current search

### Character Gallery View

**Complexity**: Low | **Value**: Medium

- Full-screen image-focused view
- Pinterest-style layout with thumbnails
- Quick preview on hover
- Great for visual reference

---

## Relationship Enhancements

### Relationship Analytics

**Complexity**: Medium | **Value**: Medium

- Identify relationship patterns
- Group by relationship type (family, friends, enemies)
- Find isolated characters or over-connected hubs
- Relationship strength indicators
- Help identify plot opportunities

### Relationship History

**Complexity**: Medium-High | **Value**: Medium

- Track how relationships change over time
- Relationship status at different story points
- Enable temporal relationship tracking

---

## Content Management

### Plot Thread / Story Arc Tracking

**Complexity**: Medium-High | **Value**: High

- Create plot threads and assign characters
- See which characters appear in which threads
- Visual representation of character involvement
- Essential for managing complex multi-threaded narratives

### Location/World Management

**Complexity**: High | **Value**: High | **Major Feature**

- Expand beyond characters to locations
- Link characters to locations
- Similar structure to characters (markdown files)
- Natural expansion of worldbuilding capabilities

### General Notes/Ideas Board

**Complexity**: Low | **Value**: Medium

- Freeform notes not tied to specific characters
- World-building ideas, plot notes
- Could use same markdown format
- Capture ideas that don't fit character files

---

## Import/Export

### Enhanced Export Options

**Complexity**: Low-Medium | **Value**: Medium

- PDF character sheets
- HTML website generation
- Markdown compilation
- CSV for spreadsheet analysis
- Share characters with others or backup in different formats

### Import from Other Tools

**Complexity**: Medium | **Value**: Low-Medium

- Import from CSV
- Import from other character tools (if common formats exist)
- Batch character creation
- Migration and bulk data entry

---

## Workflow & Productivity

### Quick Add Mode

**Complexity**: Low | **Value**: Medium | **Quick Win**

- Rapid character creation with minimal required fields
- Fill in details later
- Good for brainstorming sessions
- Reduce friction in character creation

### Duplicate Detection

**Complexity**: Medium | **Value**: Low-Medium

- Warn about similar character names
- Find characters with similar descriptions
- Prevent accidental duplicates

### Multi-Project View

**Complexity**: Medium-High | **Value**: Medium

- Work with multiple projects simultaneously
- Copy characters between projects
- Useful for shared universes

### Batch Operations

**Complexity**: Medium | **Value**: Medium

- Bulk edit tags/categories
- Batch delete/archive
- Mass tag updates
- Efficiency for large character collections

---

## Visual & UX

### Themes & Dark Mode

**Complexity**: Medium | **Value**: High | **Popular Feature**

- Dark mode support
- Custom color themes
- Per-project themes
- Better user experience, reduce eye strain

### Hierarchical Tags

**Complexity**: Medium | **Value**: Medium

- Parent/child tag relationships
- Tag groups (e.g., "Physical Traits" → "Hair Color", "Eye Color")
- Better organization for large tag collections

---

## Recommended Priorities

### Tier 1: Quick Wins (Low effort, high impact)

1. **Character Templates** - Speed up character creation
2. **Quick Add Mode** - Great for brainstorming
3. **Dark Mode** - Highly requested, improves UX
4. **Character Gallery View** - Simple visual enhancement

### Tier 2: High Value Features (Worth the effort)

1. **Scene Board** (already planned!) - Visual scene composition
2. **Timeline/Chronicle View** - Powerful for complex narratives
3. **Statistics Dashboard** - Great project overview
4. **Plot Thread Tracking** - Essential for complex stories
5. **Advanced Filtering & Search** - Power user feature

### Tier 3: Major Features (Long-term vision)

1. **Location/World Management** - Natural expansion of the app
2. **Character Arc Tracking** - Deep writing tool integration
3. **Relationship History** - Temporal relationship tracking
4. **Multi-Project View** - Advanced workflow support

---

## Implementation Notes

- Most features maintain the file-based architecture (markdown + JSON)
- New features should integrate with existing services (CharacterService, ProjectService, etc.)
- Consider data migration strategies for new metadata fields
- Maintain backward compatibility with existing work folders
