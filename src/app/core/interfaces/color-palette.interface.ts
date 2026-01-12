/**
 * Color palette configuration
 * Base colors are themable but not removable
 * Extra colors can be added and removed
 */
export interface ColorPaletteConfig {
  /**
   * Base 10 colors - themable but not removable
   * Index corresponds to the base color position
   */
  baseColors: string[];
  
  /**
   * Additional colors beyond the base 10
   * Can be added and removed freely
   */
  extraColors: string[];
  
  /**
   * Theme-specific color mappings
   * Maps theme ID to base color overrides
   * If a theme has overrides, those colors are used instead of baseColors
   */
  themeOverrides?: Record<string, string[]>;
}

/**
 * Default base color names for reference
 */
export const BASE_COLOR_NAMES = [
  'Blue',
  'Green',
  'Red',
  'Purple',
  'Orange',
  'Teal',
  'Pink',
  'Deep Orange',
  'Yellow',
  'Dark Blue-Grey'
] as const;

