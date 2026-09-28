import { Theme } from '../interfaces/theme.interface';

/**
 * Tokyo Night theme - Neon city lights over a midnight indigo sky
 * Based on the popular Tokyo Night editor/terminal palette
 */
export const tokyoNightTheme: Theme = {
  id: 'tokyo-night',
  name: 'Tokyo Night',
  description: 'Midnight indigo with neon blue accents',
  colors: {
    // Background colors - Deep indigo night
    bgPrimary: '#16161e',
    bgSecondary: '#1a1b26',
    bgTertiary: '#1f2335',
    bgElevated: '#24283b',
    bgHover: '#292e42',

    // Accent colors - Tokyo Night blue
    accentPrimary: '#7aa2f7',
    accentSecondary: '#9ab8ff',
    accentDark: '#5a82d8',
    accentMuted: '#3d59a1',
    accentSubtle: 'rgba(122, 162, 247, 0.12)',

    // Text colors - Cool lavender-whites
    textPrimary: '#c0caf5',
    textSecondary: '#a9b1d6',
    textMuted: '#737aa2',
    textInverse: '#16161e',

    // Border colors
    border: '#292e42',
    borderLight: '#3b4261',
    borderSubtle: '#1f2335',

    // Status colors
    success: '#9ece6a',
    warning: '#e0af68',
    error: '#f7768e',
    info: '#7dcfff',

    // Shadows
    shadowSm: '0 1px 3px rgba(0, 0, 0, 0.35)',
    shadowMd: '0 4px 12px rgba(0, 0, 0, 0.4)',
    shadowLg: '0 8px 24px rgba(0, 0, 0, 0.45)',
    shadowXl: '0 16px 48px rgba(0, 0, 0, 0.5)',
    shadowGlow: '0 0 24px rgba(122, 162, 247, 0.3)',
    shadowCard: '0 2px 8px rgba(0, 0, 0, 0.3), 0 0 1px rgba(0, 0, 0, 0.35)',
  },
  colorPalette: [
    '#7aa2f7', // Blue
    '#9ece6a', // Green
    '#f7768e', // Red
    '#bb9af7', // Magenta
    '#ff9e64', // Orange
    '#73daca', // Teal
    '#ff007c', // Neon Pink
    '#7dcfff', // Cyan
    '#e0af68', // Yellow
    '#565f89'  // Comment Grey
  ],
};
