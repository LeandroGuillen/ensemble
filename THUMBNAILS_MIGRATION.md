# Thumbnails Migration Guide

## Overview

Ensemble has migrated from a global `thumbnails/` directory to storing thumbnails within each character's individual folder. This change provides better organization and makes it easier to manage character assets.

## Old vs New Structure

### Old Structure (Deprecated)

```
project-folder/
├── ensemble.json
├── characters/
│   ├── character-1.md
│   └── character-2.md
└── thumbnails/              # ❌ Global thumbnails directory
    ├── character-1.jpg
    └── character-2.png
```

### New Structure (Current)

```
project-folder/
├── ensemble.json
└── characters/
    ├── main-characters/
    │   └── john-doe/
    │       ├── john-doe.md
    │       └── thumbnail.png    # ✅ Thumbnail in character folder
    └── villains/
        └── jane-smith/
            ├── jane-smith.md
            └── thumbnail.jpg    # ✅ Thumbnail in character folder
```

## Migration

### Automatic Migration

If you have an existing project with the old structure, use the migration script:

```bash
node scripts/migrate-to-folder-structure.js /path/to/your/project
```

This script will:

1. Create a backup of your characters directory
2. Convert flat character files to the new folder structure
3. Move thumbnails from the global directory into character folders
4. Update thumbnail references in character frontmatter
5. Clean up the empty global thumbnails directory

### Manual Migration

If you prefer to migrate manually:

1. **Backup your project** before making changes
2. For each character:
   - Create a folder structure: `characters/<category>/<character-slug>/`
   - Move the character `.md` file into their folder
   - Move their thumbnail from `thumbnails/` into their character folder
   - Rename the thumbnail to a simple name like `thumbnail.png`
   - Update the `thumbnail:` field in the character's frontmatter

## Current Behavior

### New Projects

- New projects no longer create a global `thumbnails/` directory
- Thumbnails are automatically stored in character folders when uploaded

### Existing Projects

- If you still have a global `thumbnails/` directory, it won't be used by new characters
- Old characters with thumbnails in the global directory will still work until migrated
- The migration script can safely convert your project to the new structure

## Benefits of New Structure

1. **Better Organization**: Each character's assets are contained in their own folder
2. **Easier Backup**: Character folders are self-contained units
3. **External Editing**: You can easily work with character folders in file managers
4. **Future-Proof**: Supports additional character assets (multiple images, documents, etc.)
5. **Version Control**: Character folders work better with Git and other VCS systems

## Troubleshooting

### Missing Thumbnails After Migration

- Check that the migration script completed successfully
- Verify thumbnail files were copied to character folders
- Ensure the `thumbnail:` field in frontmatter points to the correct filename

### Global Thumbnails Directory Still Exists

- If empty, you can safely delete it
- If it contains files, run the migration script or move files manually
- New characters won't use this directory

### Character Not Found After Migration

- Check the backup created by the migration script
- Verify the character folder structure matches the expected format
- Ensure the character `.md` file is named correctly (should match folder name)
