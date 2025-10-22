# Cast Dropdown Component

A reusable dropdown component for selecting casts with visual thumbnails and character collages.

## Features

- **Visual cast selection** with character thumbnails or cast name abbreviations
- **Character thumbnail collages** (up to 4 characters per cast)
- **Compact design** that fits well in filter bars
- **Configurable labels** and behavior
- **Automatic thumbnail loading** and caching

## Usage

```html
<app-cast-dropdown
  [casts]="casts"
  [characters]="characters"
  [selectedCastId]="selectedCast"
  [showCharacterThumbnails]="true"
  [label]="'Cast:'"
  [allLabel]="'All Characters'"
  (castChange)="onCastChange($event)"
></app-cast-dropdown>
```

## Inputs

| Property                  | Type          | Default            | Description                                  |
| ------------------------- | ------------- | ------------------ | -------------------------------------------- |
| `casts`                   | `Cast[]`      | `[]`               | Array of available casts                     |
| `characters`              | `Character[]` | `[]`               | Array of all characters (for thumbnails)     |
| `selectedCastId`          | `string`      | `''`               | Currently selected cast ID                   |
| `showCharacterThumbnails` | `boolean`     | `true`             | Whether to show character thumbnail collages |
| `label`                   | `string`      | `'Cast:'`          | Label text for the dropdown                  |
| `allLabel`                | `string`      | `'All Characters'` | Text for the "all" option                    |

## Outputs

| Event        | Type     | Description                                                   |
| ------------ | -------- | ------------------------------------------------------------- |
| `castChange` | `string` | Emitted when cast selection changes (cast ID or empty string) |

## Visual Behavior

1. **Cast with character thumbnails**: Shows up to 4 character thumbnails in a grid
2. **Cast without thumbnails**: Shows first 4 characters of cast name as abbreviation
3. **Selected state**: Highlights the selected cast with accent color
4. **Hover states**: Provides visual feedback on hover

## Example Implementation

```typescript
export class MyComponent {
  casts: Cast[] = [];
  characters: Character[] = [];
  selectedCast = "";

  onCastChange(castId: string): void {
    this.selectedCast = castId;
    // Apply filtering logic here
  }
}
```

## Styling

The component uses CSS custom properties from the global theme:

- `--color-bg-elevated`
- `--color-border`
- `--color-accent-primary`
- `--radius-md`
- `--spacing-*`

All styles are encapsulated within the component.
