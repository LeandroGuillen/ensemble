# Backstage Feature

The Backstage feature provides a creative workspace for brainstorming character ideas before they're ready to "take the stage" as full characters.

## Features

### Character Concepts

- Quick notes for character ideas
- Optional title field
- Inline editing (click to edit, blur to save)
- "Take the Stage" button (⭐) to promote concept to a full character

### Name Lists

- Organize character names in categorized lists
- List titles can be customized (e.g., "Fantasy Names", "Cities", "Villain Names")
- Add/remove names easily
- "Take the Stage" button (⭐) on each name to create a character with that name pre-filled

## Usage

1. Click the Backstage icon (🎪) in the sidebar
2. Create concepts or name lists using the buttons in the header
3. Edit inline by clicking on titles or text areas
4. Click the ⭐ button to promote a concept or name to a full character

## Data Storage

All backstage data is stored as **simple markdown files** in the `backstage/` folder.

### `backstage/concepts.md`

Each concept is a section:

```markdown
## Mysterious Stranger

Wears a long coat, knows too much about the protagonist's past.
Possibly connected to the ancient order?

## Young Apprentice

Eager to learn but reckless. Has natural talent but lacks discipline.
```

### `backstage/names.md`

Each name list is a section with names as bullet points:

```markdown
## Fantasy Names

- Aldric
- Elara
- Thorne
- Cassian

## Cities

- Silverhaven
- Ironforge
- Shadowmere
```

## Implementation Details

### Components

- `BackstageComponent` - Main page with side-by-side layout
- `ConceptCardComponent` - Individual concept card with inline editing
- `NameListCardComponent` - Name list with add/remove functionality

### Services

- `BackstageService` - Manages concepts and name lists, persists to markdown files

### Routing

- Route: `/backstage`
- Protected by `projectGuard` (requires active project)

### Theatrical Terminology

Instead of "promote", we use "Take the Stage" (⭐) to maintain the theatrical theme of Ensemble.
