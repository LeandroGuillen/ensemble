# Multiple Images Per Character - Feature Plan

**Feature**: Replace single thumbnail with a flexible image library system for characters

**Date Started**: 2025-11-07
**Status**: Phase 1 Complete (Backend/Data Layer) ✅

---

## Requirements Summary

Based on user input during planning:

- **Organization**: Image library with categories/tags
- **Thumbnail Approach**: Merge into unified images collection with one designated as primary
- **Metadata**: Store filename + tags/categories for each image
- **List Display**: Slideshow/rotation of images in character list views (grid/gallery)

---

## Architecture Overview

### Data Model

**CharacterImage Interface**:
```typescript
export interface CharacterImage {
  id: string;              // Unique ID for the image
  filename: string;        // Filename in the images/ folder (e.g., "portrait.png")
  tags: string[];          // Image tags/categories (e.g., ["portrait", "reference-art"])
  isPrimary: boolean;      // Whether this is the primary/thumbnail image
  order: number;           // Display order (0-indexed)
}
```

**Character Interface Updates**:
```typescript
export interface Character {
  // ... existing fields ...
  thumbnail?: string;      // DEPRECATED: For backward compatibility only
  images: CharacterImage[]; // New image library with tags and metadata
  // ... other fields ...
}
```

### File Storage Structure

```
project-folder/
└── characters/
    └── <category-slug>/
        └── <character-slug>/
            ├── <character-slug>.md       # Main character file
            ├── images/                   # NEW: All character images here
            │   ├── portrait.png
            │   ├── action-pose.jpg
            │   └── reference-art.webp
            └── additional-field.md
```

### Frontmatter Format

Character markdown file (`<character-slug>.md`):
```yaml
---
name: "Character Name"
category: "main-character"
tags: ["protagonist", "magic-user"]
books: ["book-id-1"]
images:
  - id: "img-001"
    filename: "portrait.png"
    tags: ["portrait", "official"]
    isPrimary: true
    order: 0
  - id: "img-002"
    filename: "action-pose.jpg"
    tags: ["action", "reference"]
    isPrimary: false
    order: 1
mangamaster: "url-to-image"
created: "2024-01-15T10:30:00Z"
modified: "2024-01-20T14:45:00Z"
---

## Description
...
```

---

## Implementation Phases

### Phase 1: Backend/Data Layer ✅ COMPLETE

**Tasks**:
1. ✅ Update Character interface with CharacterImage type
2. ✅ Add migration logic to CharacterService (thumbnail → images)
3. ✅ Update markdown parsing/serialization for images array
4. ✅ Implement new CharacterService methods (add/remove/update images)
5. ✅ Add IPC handlers for multi-image operations
6. ✅ Update ElectronService with new image methods
7. ✅ Run build to verify no compilation errors

**Files Modified**:
- `src/app/core/interfaces/character.interface.ts` - Added CharacterImage interface
- `src/app/core/services/character.service.ts` - Migration logic + new methods
- `main.js` - Added `select-images` IPC handler
- `src/app/core/services/electron.service.ts` - Added `selectImages()` method

**New CharacterService Methods**:
- `addImage(characterId, imageFilePath, tags)` - Adds image to character's images/ folder
- `removeImage(characterId, imageId)` - Deletes image file and metadata
- `updateImageMetadata(characterId, imageId, updates)` - Updates tags and order
- `setPrimaryImage(characterId, imageId)` - Designates primary/thumbnail image
- `reorderImages(characterId, imageIds)` - Changes display order
- `getImagePath(characterId, imageId)` - Gets full path to image file
- `getPrimaryImage(character)` - Gets primary image for character

**Migration Strategy**:
- Automatically detects old `thumbnail` field in existing characters
- Converts to `images` array with single entry marked as `isPrimary: true`
- File migration to `images/` subfolder happens on next save
- Preserves existing data and backward compatibility

**Build Status**: ✅ Build completed successfully with no compilation errors

---

### Phase 2: UI - Character Detail (Pending)

**Tasks**:
8. ⏳ Create ImageLibraryComponent for character detail page
9. ⏳ Implement image upload (multi-select) UI
10. ⏳ Build image grid with thumbnail previews
11. ⏳ Add tag filtering UI for images
12. ⏳ Implement drag-and-drop reordering for images
13. ⏳ Add edit/delete/set-primary actions per image

**Component Design**: ImageLibraryComponent
- **Location**: `src/app/features/character-detail/components/image-library/`
- **Features**:
  - Grid display of all images with thumbnails
  - Filter by tags (dropdown or chips)
  - Add new images (multi-select dialog)
  - Edit image metadata (tags, set as primary)
  - Reorder via drag-and-drop
  - Delete images with confirmation
  - Primary image indicator (star/badge icon)

**UI Layout**:
```
┌─────────────────────────────────────────┐
│  Images  [+ Add Images ▼]   [🏷️ Filter] │
├─────────────────────────────────────────┤
│  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐    │
│  │ ⭐  │  │     │  │     │  │     │    │
│  │ img │  │ img │  │ img │  │ img │    │
│  │  1  │  │  2  │  │  3  │  │  4  │    │
│  └─────┘  └─────┘  └─────┘  └─────┘    │
│  portrait  action  reference concept    │
│  [✏️][🗑️]  [✏️][🗑️]  [✏️][🗑️]  [✏️][🗑️]     │
└─────────────────────────────────────────┘
```

---

### Phase 3: UI - Character List (Pending)

**Tasks**:
14. ⏳ Implement slideshow/rotation in gallery view
15. ⏳ Implement slideshow/rotation in grid view
16. ⏳ Add smooth transitions and animations for slideshow
17. ⏳ Optimize performance (lazy loading, caching)

**Slideshow Implementation**:
- Auto-rotate through images (3-5 seconds per image)
- Smooth fade/crossfade transitions
- Pause on hover (optional)
- Show primary image first, then cycle through others
- Fallback to placeholder if no images
- Performance optimization: only animate visible items

**Files to Modify**:
- `src/app/features/character-list/character-list.component.ts`
- `src/app/features/character-list/views/character-gallery-view/`
- `src/app/features/character-list/views/character-grid-view/`

**Caching Strategy**:
- Extend existing `thumbnailDataUrls` Map to support multiple images per character
- Lazy-load images as user scrolls
- Preload primary images first
- Load additional images on hover or in background

---

### Phase 4: Metadata Management (Pending)

**Tasks**:
18. ⏳ Create ImageCategoryService for tag management
19. ⏳ Add image tags section to metadata management page
20. ⏳ Update ensemble.json schema for image tags

**ImageCategoryService**:
- **Location**: `src/app/core/services/image-category.service.ts`
- **Purpose**: Manage predefined image tag categories
- **Storage**: Store in `ensemble.json` like other metadata
- **Methods**:
  - `getImageTags()` - Get all image tags for current project
  - `addImageTag(tag)` - Add new tag
  - `updateImageTag(oldTag, newTag)` - Rename tag
  - `deleteImageTag(tag)` - Remove tag

**ensemble.json Schema Update**:
```json
{
  "categories": [...],
  "tags": [...],
  "books": [...],
  "imageTags": [
    "portrait",
    "action",
    "reference-art",
    "concept-art",
    "full-body",
    "headshot",
    "expression"
  ],
  "settings": {...},
  "relationships": {...}
}
```

**Metadata Management UI**:
- Add new section: "Image Tags"
- CRUD interface similar to categories/tags
- Used across all characters for consistent tagging

---

### Phase 5: Migration & Testing (Pending)

**Tasks**:
21. ⏳ Test migration of existing characters with thumbnails
22. ⏳ Test backward compatibility
23. ⏳ Verify file watcher handles new images/ folder
24. ⏳ Test external editing of frontmatter images array

**Test Scenarios**:
1. **Migration Test**:
   - Create character with old `thumbnail` field
   - Load character and verify auto-migration to `images` array
   - Verify primary flag is set correctly
   - Verify file is eventually moved to `images/` folder

2. **CRUD Operations**:
   - Add multiple images to character
   - Remove image and verify file deletion
   - Update image tags
   - Set different image as primary
   - Reorder images via drag-and-drop

3. **External Editing**:
   - Manually edit character markdown file
   - Add/remove images in frontmatter
   - Verify FileWatcher picks up changes
   - Verify UI updates correctly

4. **Performance**:
   - Test with 100+ characters with multiple images
   - Verify smooth scrolling in list views
   - Verify slideshow doesn't cause lag
   - Check memory usage with many images

5. **Backward Compatibility**:
   - Old projects with `thumbnail` field still work
   - Mixed projects (some with images, some with thumbnail) work
   - No data loss during migration

---

## Technical Considerations

### Performance Optimizations

**Data URL Caching**:
- Cache image data URLs like current implementation
- Use `Map<string, Map<string, string>>` for character → images mapping
- Lazy-load images in detail view (only load visible thumbnails)
- Debounce slideshow animations

**Change Detection**:
- Use Angular's OnPush change detection strategy
- Minimize re-renders during slideshow transitions
- Use NgZone.runOutsideAngular for animations

**Memory Management**:
- Limit number of cached data URLs (LRU cache)
- Clear cache when navigating away from character list
- Use smaller thumbnail versions for list views

### User Experience

**Fast Character List Rendering**:
- Primary images load first
- Additional images load in background
- Slideshow starts only for visible items

**Smooth Transitions**:
- CSS transitions for fade effects
- RequestAnimationFrame for smooth animations
- No jank during scrolling

**Clear Visual Indicators**:
- Star icon for primary image
- Badge showing image count
- Tag chips with colors
- Drag handle for reordering

### Data Safety

**Atomic File Operations**:
- Use existing `writeFileAtomic` for character saves
- Validate image file types before copying
- Handle missing/corrupted images gracefully
- Preserve existing thumbnails during migration

**Error Handling**:
- Graceful degradation if images/ folder missing
- Fallback to placeholder if image load fails
- User-friendly error messages
- Don't break character loading if one image fails

---

## File Locations Reference

### Backend/Data Layer
| Component | File Path | Status |
|-----------|-----------|--------|
| CharacterImage interface | `src/app/core/interfaces/character.interface.ts:1-7` | ✅ Done |
| Character interface | `src/app/core/interfaces/character.interface.ts:9-26` | ✅ Done |
| CharacterFormData interface | `src/app/core/interfaces/character.interface.ts:28-38` | ✅ Done |
| CharacterFrontmatter | `src/app/core/services/character.service.ts:10-21` | ✅ Done |
| Migration logic | `src/app/core/services/character.service.ts:747-762` | ✅ Done |
| Save with images | `src/app/core/services/character.service.ts:849-874` | ✅ Done |
| addImage() | `src/app/core/services/character.service.ts:1129-1187` | ✅ Done |
| removeImage() | `src/app/core/services/character.service.ts:1189-1240` | ✅ Done |
| updateImageMetadata() | `src/app/core/services/character.service.ts:1242-1279` | ✅ Done |
| setPrimaryImage() | `src/app/core/services/character.service.ts:1281-1317` | ✅ Done |
| reorderImages() | `src/app/core/services/character.service.ts:1319-1358` | ✅ Done |
| getImagePath() | `src/app/core/services/character.service.ts:1360-1376` | ✅ Done |
| getPrimaryImage() | `src/app/core/services/character.service.ts:1378-1384` | ✅ Done |
| IPC: select-images | `main.js:93-102` | ✅ Done |
| selectImages() method | `src/app/core/services/electron.service.ts:123-128` | ✅ Done |

### UI Components (Pending)
| Component | Planned Location | Status |
|-----------|-----------------|--------|
| ImageLibraryComponent | `src/app/features/character-detail/components/image-library/` | ⏳ Pending |
| Gallery slideshow | `src/app/features/character-list/views/character-gallery-view/` | ⏳ Pending |
| Grid slideshow | `src/app/features/character-list/views/character-grid-view/` | ⏳ Pending |
| ImageCategoryService | `src/app/core/services/image-category.service.ts` | ⏳ Pending |
| Metadata UI updates | `src/app/features/metadata-management/` | ⏳ Pending |

---

## API Reference

### CharacterService Methods (New)

```typescript
// Add image to character
async addImage(
  characterId: string,
  imageFilePath: string,
  tags: string[] = []
): Promise<void>

// Remove image from character
async removeImage(
  characterId: string,
  imageId: string
): Promise<void>

// Update image metadata
async updateImageMetadata(
  characterId: string,
  imageId: string,
  updates: Partial<CharacterImage>
): Promise<void>

// Set primary/thumbnail image
async setPrimaryImage(
  characterId: string,
  imageId: string
): Promise<void>

// Reorder images
async reorderImages(
  characterId: string,
  imageIds: string[]
): Promise<void>

// Get path to image file
async getImagePath(
  characterId: string,
  imageId: string
): Promise<string | null>

// Get primary image for character
getPrimaryImage(
  character: Character
): CharacterImage | null
```

### ElectronService Methods (New)

```typescript
// Open multi-select image dialog
async selectImages(): Promise<string[]>
```

### IPC Handlers (New)

```javascript
// main.js
ipcMain.handle('select-images', async () => {
  // Returns array of selected file paths
  return result.canceled ? [] : result.filePaths;
});
```

---

## Next Steps

**Immediate Next Task**: Create ImageLibraryComponent for character detail page

**Priority Order**:
1. Phase 2: Character Detail UI (highest priority - core feature)
2. Phase 4: Metadata Management (needed for tag filtering)
3. Phase 3: List View Slideshow (polish feature)
4. Phase 5: Testing & Migration validation

**Estimated Complexity**:
- **Phase 2**: Medium-High (drag-drop, tag UI)
- **Phase 3**: Medium-High (slideshow animations)
- **Phase 4**: Low-Medium (similar to existing metadata)
- **Phase 5**: Medium (thorough testing required)

**Total Remaining Tasks**: 14 pending tasks

---

## Notes

- All backend infrastructure is complete and tested ✅
- Build passes with no errors ✅
- Migration logic handles backward compatibility ✅
- Images stored in character-specific `images/` folder for organization
- Primary image concept maintains thumbnail behavior for existing UI
- Tag system will be project-specific (stored in ensemble.json)
- Performance optimizations are critical for smooth UX
- Slideshow feature is a nice-to-have polish element

---

**Last Updated**: 2025-11-07
**Next Review**: After Phase 2 completion
