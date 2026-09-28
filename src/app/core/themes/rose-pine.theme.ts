import { Theme } from '../interfaces/theme.interface';

/**
 * Rosé Pine theme - Soho vibes with muted rose and pine tones
 * Based on the popular Rosé Pine palette
 */
export const rosePineTheme: Theme = {
  id: 'rose-pine',
  name: 'Rosé Pine',
  description: 'Muted plum with soft rose accents',
  colors: {
    // Background colors - Base, surface, overlay
    bgPrimary: '#141220',
    bgSecondary: '#191724',
    bgTertiary: '#1f1d2e',
    bgElevated: '#26233a',
    bgHover: '#403d52',

    // Accent colors - Rose
    accentPrimary: '#ebbcba',
    accentSecondary: '#f4d4d2',
    accentDark: '#d7827e',
    accentMuted: '#8a5f63',
    accentSubtle: 'rgba(235, 188, 186, 0.12)',

    // Text colors
    textPrimary: '#e0def4',
    textSecondary: '#908caa',
    textMuted: '#6e6a86',
    textInverse: '#191724',

    // Border colors
    border: '#403d52',
    borderLight: '#524f67',
    borderSubtle: '#21202e',

    // Status colors
    success: '#9ccfd8',
    warning: '#f6c177',
    error: '#eb6f92',
    info: '#c4a7e7',

    // Shadows
    shadowSm: '0 1px 3px rgba(0, 0, 0, 0.35)',
    shadowMd: '0 4px 12px rgba(0, 0, 0, 0.4)',
    shadowLg: '0 8px 24px rgba(0, 0, 0, 0.45)',
    shadowXl: '0 16px 48px rgba(0, 0, 0, 0.5)',
    shadowGlow: '0 0 24px rgba(235, 188, 186, 0.25)',
    shadowCard: '0 2px 8px rgba(0, 0, 0, 0.3), 0 0 1px rgba(0, 0, 0, 0.35)',
  },
  colorPalette: [
    '#31748f', // Pine
    '#9ccfd8', // Foam
    '#eb6f92', // Love
    '#c4a7e7', // Iris
    '#f6c177', // Gold
    '#56949f', // Dawn Foam
    '#ebbcba', // Rose
    '#d7827e', // Dawn Rose
    '#ea9d34', // Dawn Gold
    '#6e6a86'  // Muted
  ],
};
