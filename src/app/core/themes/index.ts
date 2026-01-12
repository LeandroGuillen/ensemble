/**
 * Theme exports
 * Add new themes here as they are created
 */
export { blueGoldTheme } from './blue-gold.theme';
export { grayscaleTheme } from './grayscale.theme';
export { sepiaTheme } from './sepia.theme';

// Import all themes for easy access
import { blueGoldTheme } from './blue-gold.theme';
import { grayscaleTheme } from './grayscale.theme';
import { sepiaTheme } from './sepia.theme';
import { Theme } from '../interfaces/theme.interface';

/**
 * Array of all available themes
 * Add new themes to this array
 */
export const themes: Theme[] = [
  blueGoldTheme,
  grayscaleTheme,
  sepiaTheme,
];

/**
 * Get a theme by ID
 */
export function getThemeById(id: string): Theme | undefined {
  return themes.find(theme => theme.id === id);
}

/**
 * Get the default theme
 */
export function getDefaultTheme(): Theme {
  return blueGoldTheme;
}

