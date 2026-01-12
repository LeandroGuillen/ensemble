/**
 * Default base color palette for categories and tags
 * These are 10 distinct, visually unique colors that can be used
 * for any number of categories or tags
 * 
 * Note: Use ColorPaletteService to get the current palette,
 * which may include theme overrides and extra colors
 */
export const DEFAULT_BASE_COLORS = [
  '#3498db', // Blue
  '#2ecc71', // Green
  '#e74c3c', // Red
  '#9b59b6', // Purple
  '#f39c12', // Orange
  '#1abc9c', // Teal
  '#e91e63', // Pink
  '#ff5722', // Deep Orange
  '#f1c40f', // Yellow
  '#34495e'  // Dark Blue-Grey
] as const;

/**
 * @deprecated Use ColorPaletteService.getAllColors() instead
 * Kept for backward compatibility
 */
export const COLOR_PALETTE = DEFAULT_BASE_COLORS;

/**
 * Gets a color from the palette by index (wraps around if index exceeds palette size)
 */
export function getColorFromPalette(index: number): string {
  return COLOR_PALETTE[index % COLOR_PALETTE.length];
}

/**
 * Gets the next available color from the palette that hasn't been used
 */
export function getNextAvailableColor(usedColors: string[]): string {
  for (const color of COLOR_PALETTE) {
    if (!usedColors.includes(color)) {
      return color;
    }
  }
  // If all colors are used, return the first one
  return COLOR_PALETTE[0];
}

